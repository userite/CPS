import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sql, { type ConnectionPool, type IResult, type Transaction } from "mssql";
import {
  parseParameterRole,
  parseStates,
  pickStateValue,
  rangeFromStates,
} from "../domain/normalizeParameterStates";
import { resolveParameterRole, type ParameterStateDef } from "../domain/parameterRole";
import {
  BlondinaInputError,
  nextGeneratedValue,
  normalizeColor,
  normalizeRange,
  numberOrNull,
  requireId,
  requireName,
  text,
  type AsyncBlondina,
  type DashboardReading,
  type FirstObjectReading,
  type GenerateResult,
  type MachineInput,
  type MachineKind,
  type MachineRow,
  type ParameterInput,
  type ParameterRole,
  type ParameterRow,
} from "./blondina";

const MAX_GENERATED_ROWS = 20_000;

export type BlondinaSqlConfig = {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

function readEnvFile(path: string): Record<string, string> {
  try {
    const values: Record<string, string> = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=]+)=(.*)$/);
      if (!match) continue;
      values[match[1].trim()] = match[2].trim();
    }
    return values;
  } catch {
    return {};
  }
}

export function loadBlondinaSqlConfig(cwd = process.cwd()): BlondinaSqlConfig {
  const file = readEnvFile(resolve(cwd, ".env.local"));
  const value = (key: string) => process.env[key] || file[key] || "";
  const server = value("CPS_SQL_SERVER");
  const database = value("CPS_SQL_DATABASE");
  const user = value("CPS_SQL_USER");
  const password = value("CPS_SQL_PASSWORD");
  const port = Number(value("CPS_SQL_PORT") || "14333");
  if (!server || !database || !user || !password || !Number.isInteger(port)) {
    throw new Error(
      "Липсват CPS_SQL_SERVER, CPS_SQL_PORT, CPS_SQL_DATABASE, CPS_SQL_USER или CPS_SQL_PASSWORD.",
    );
  }
  return { server, port, database, user, password };
}

type MachineRecord = {
  id: string;
  name: string;
  model: string | null;
  kind: string;
  createdAt: Date | string;
};

type ParameterRecord = {
  id: string;
  label: string;
  unit: string | null;
  rangeMin: number | null;
  rangeMax: number | null;
  sampleIntervalSeconds: number | null;
  color: string | null;
  role: string | null;
};

type StateRecord = {
  parameterId: string;
  value: number;
  label: string;
  color: string;
  sortOrder: number;
};

type LinkRecord = {
  machineId: string;
  parameterId: string;
};

type SeriesRecord = {
  machineId: string;
  parameterId: string;
  rangeMin: number | null;
  rangeMax: number | null;
  sampleIntervalSeconds: number | null;
  role: string | null;
};

type SampleRecord = {
  measuredAt: Date | string;
  value: number | null;
};

type MeasurementRecord = {
  machineId: string;
  machineName: string;
  parameterId: string;
  parameterLabel: string;
  unit: string | null;
  measuredAt: Date | string;
  value: number | null;
};

type CountRecord = { count: number };

function rowsAffected(result: IResult<unknown>): number {
  return result.rowsAffected[0] ?? 0;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function sqlErrorNumber(error: unknown): number | undefined {
  if (typeof error === "object" && error && "number" in error && typeof error.number === "number") {
    return error.number;
  }
  return undefined;
}

function asKind(value: string): MachineKind {
  return value === "lathe" ? "lathe" : "other";
}

async function withTransaction<T>(pool: ConnectionPool, action: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await action(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

async function upsertMeasurements(
  tx: Transaction,
  rows: Array<{ machineId: string; parameterId: string; measuredAt: string; value: number }>,
): Promise<void> {
  const chunkSize = 400;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const request = new sql.Request(tx);
    request.input("rows", sql.NVarChar(sql.MAX), JSON.stringify(rows.slice(index, index + chunkSize)));
    await request.query(`
      MERGE dbo.cps_measurement AS target
      USING (
        SELECT machineId, parameterId, CAST(measuredAt AS datetime2) AS measuredAt, value
        FROM OPENJSON(@rows)
        WITH (
          machineId nvarchar(64) '$.machineId',
          parameterId nvarchar(64) '$.parameterId',
          measuredAt nvarchar(40) '$.measuredAt',
          value float '$.value'
        )
      ) AS source
      ON target.machine_id = source.machineId
        AND target.parameter_id = source.parameterId
        AND target.measured_at = source.measuredAt
      WHEN MATCHED THEN UPDATE SET value = source.value
      WHEN NOT MATCHED THEN
        INSERT (machine_id, parameter_id, measured_at, value)
        VALUES (source.machineId, source.parameterId, source.measuredAt, source.value);
    `);
  }
}

export async function openBlondinaSql(config: BlondinaSqlConfig): Promise<AsyncBlondina> {
  const label = `${config.database} @ ${config.server}:${config.port}`;
  const pool = new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionTimeout: 20_000,
    requestTimeout: 60_000,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      useUTC: true,
    },
    pool: { max: 8, min: 0, idleTimeoutMillis: 30_000 },
  });
  try {
    await pool.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = config.password && message.includes(config.password) ? "" : message;
    throw new Error(`Няма връзка към ${label}.${safe ? ` ${safe}` : ""}`);
  }
  await pool.request().query(`
    IF COL_LENGTH('dbo.cps_parameter', 'color') IS NULL
      ALTER TABLE dbo.cps_parameter ADD color nvarchar(7) NULL;
    IF COL_LENGTH('dbo.cps_parameter', 'role') IS NULL
      ALTER TABLE dbo.cps_parameter ADD role nvarchar(16) NULL;
    IF OBJECT_ID(N'dbo.cps_parameter_state', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.cps_parameter_state (
        parameter_id  NVARCHAR(64)  NOT NULL,
        value         FLOAT         NOT NULL,
        label         NVARCHAR(200) NOT NULL,
        color         NVARCHAR(7)   NOT NULL,
        sort_order    INT           NOT NULL CONSTRAINT DF_cps_parameter_state_sort DEFAULT 0,
        CONSTRAINT PK_cps_parameter_state PRIMARY KEY (parameter_id, value),
        CONSTRAINT FK_cps_parameter_state_parameter FOREIGN KEY (parameter_id)
          REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE
      );
    END
  `);

  async function loadStatesMap(): Promise<Map<string, ParameterStateDef[]>> {
    const result = await pool.request().query<StateRecord>(`
      SELECT parameter_id AS parameterId, value, label, color, sort_order AS sortOrder
      FROM dbo.cps_parameter_state
      ORDER BY parameter_id, sort_order, value
    `);
    const map = new Map<string, ParameterStateDef[]>();
    for (const row of result.recordset) {
      const id = String(row.parameterId);
      const list = map.get(id) ?? [];
      list.push({
        value: Number(row.value),
        label: String(row.label),
        color: String(row.color),
      });
      map.set(id, list);
    }
    return map;
  }

  async function replaceStates(tx: Transaction, parameterId: string, states: ParameterStateDef[]) {
    await new sql.Request(tx)
      .input("parameterId", sql.NVarChar(64), parameterId)
      .query("DELETE FROM dbo.cps_parameter_state WHERE parameter_id = @parameterId");
    for (const [index, state] of states.entries()) {
      await new sql.Request(tx)
        .input("parameterId", sql.NVarChar(64), parameterId)
        .input("value", sql.Float, state.value)
        .input("label", sql.NVarChar(200), state.label)
        .input("color", sql.NVarChar(7), state.color)
        .input("sortOrder", sql.Int, index)
        .query(`
          INSERT INTO dbo.cps_parameter_state (parameter_id, value, label, color, sort_order)
          VALUES (@parameterId, @value, @label, @color, @sortOrder)
        `);
    }
  }

  function prepareParameterWrite(input: ParameterInput): {
    role: ParameterRole;
    states: ParameterStateDef[];
    rangeMin: number | null;
    rangeMax: number | null;
    sampleIntervalSeconds: number | null;
    color: string | null;
  } {
    const role = parseParameterRole(input.role);
    const parsed = parseStates(input.states, role);
    if (parsed.error) throw new BlondinaInputError(parsed.error);
    const states = parsed.states;
    const range = normalizeRange(
      numberOrNull(input.rangeMin),
      numberOrNull(input.rangeMax),
      numberOrNull(input.sampleIntervalSeconds),
    );
    if (role === "status") {
      const fromStates = rangeFromStates(states);
      if (!fromStates) throw new BlondinaInputError("Статусният параметър трябва да има състояния.");
      if (range.sampleIntervalSeconds == null) {
        throw new BlondinaInputError("Статусният параметър трябва да има честота.");
      }
      return {
        role,
        states,
        rangeMin: fromStates.rangeMin,
        rangeMax: fromStates.rangeMax,
        sampleIntervalSeconds: range.sampleIntervalSeconds,
        color: null,
      };
    }
    return {
      role,
      states: [],
      rangeMin: range.rangeMin,
      rangeMax: range.rangeMax,
      sampleIntervalSeconds: range.sampleIntervalSeconds,
      color: normalizeColor(input.color),
    };
  }

  const listMachines = async (): Promise<MachineRow[]> => {
    const result = await pool.request().query<MachineRecord>(`
      SELECT id, name, model, kind, created_at AS createdAt
      FROM dbo.cps_machine
      ORDER BY name
    `);
    return result.recordset.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      model: row.model == null ? null : String(row.model),
      kind: asKind(String(row.kind)),
      createdAt: iso(row.createdAt),
    }));
  };

  const listParameters = async (): Promise<ParameterRow[]> => {
    const parameters = await pool.request().query<ParameterRecord>(`
      SELECT id, label, unit, range_min AS rangeMin, range_max AS rangeMax,
             sample_interval_seconds AS sampleIntervalSeconds, color, role
      FROM dbo.cps_parameter
      ORDER BY label
    `);
    const links = await pool.request().query<LinkRecord>(`
      SELECT machine_id AS machineId, parameter_id AS parameterId
      FROM dbo.cps_machine_parameter
    `);
    const statesMap = await loadStatesMap();
    return parameters.recordset.map((row) => {
      const id = String(row.id);
      const label = String(row.label);
      return {
        id,
        label,
        unit: String(row.unit ?? ""),
        rangeMin: row.rangeMin == null ? null : Number(row.rangeMin),
        rangeMax: row.rangeMax == null ? null : Number(row.rangeMax),
        sampleIntervalSeconds: row.sampleIntervalSeconds == null ? null : Number(row.sampleIntervalSeconds),
        color: row.color == null ? null : String(row.color),
        role: resolveParameterRole(label, id, row.role),
        states: statesMap.get(id) ?? [],
        machineIds: links.recordset
          .filter((link) => link.parameterId === id)
          .map((link) => String(link.machineId)),
      };
    });
  };

  async function machineIds(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    for (const id of unique) {
      const result = await pool
        .request()
        .input("id", sql.NVarChar(64), id)
        .query("SELECT id FROM dbo.cps_machine WHERE id = @id");
      if (result.recordset.length === 0) throw new BlondinaInputError(`Няма машина ${id}.`);
    }
    return unique;
  }

  async function replaceLinks(tx: Transaction, parameterId: string, ids: string[]): Promise<void> {
    await new sql.Request(tx)
      .input("parameterId", sql.NVarChar(64), parameterId)
      .query("DELETE FROM dbo.cps_machine_parameter WHERE parameter_id = @parameterId");
    for (const machineId of ids) {
      await new sql.Request(tx)
        .input("machineId", sql.NVarChar(64), machineId)
        .input("parameterId", sql.NVarChar(64), parameterId)
        .query(
          "INSERT INTO dbo.cps_machine_parameter (machine_id, parameter_id) VALUES (@machineId, @parameterId)",
        );
    }
  }

  return {
    kind: "sqlserver",
    path: label,
    async getState() {
      const count = await pool.request().query<CountRecord>("SELECT COUNT(*) AS count FROM dbo.cps_measurement");
      return {
        dbPath: label,
        machines: await listMachines(),
        parameters: await listParameters(),
        measurementCount: Number(count.recordset[0]?.count ?? 0),
      };
    },
    async createMachine(input: MachineInput) {
      const id = requireId(input.id, "Идентификаторът");
      const name = requireName(input.name, "Името");
      if (input.kind !== "lathe" && input.kind !== "other") {
        throw new BlondinaInputError("Видът трябва да е струг или друга машина.");
      }
      const existing = await pool
        .request()
        .input("id", sql.NVarChar(64), id)
        .query("SELECT id FROM dbo.cps_machine WHERE id = @id");
      if (existing.recordset.length > 0) {
        throw new BlondinaInputError("Вече има машина с този идентификатор.");
      }
      try {
        await pool
          .request()
          .input("id", sql.NVarChar(64), id)
          .input("name", sql.NVarChar(200), name)
          .input("model", sql.NVarChar(200), text(input.model))
          .input("kind", sql.NVarChar(16), input.kind)
          .query("INSERT INTO dbo.cps_machine (id, name, model, kind) VALUES (@id, @name, @model, @kind)");
      } catch (error) {
        if (sqlErrorNumber(error) === 2627 || sqlErrorNumber(error) === 2601) {
          throw new BlondinaInputError("Вече има машина с този идентификатор.");
        }
        throw error;
      }
    },
    async updateMachine(input: MachineInput) {
      const id = requireId(input.id, "Идентификаторът");
      const name = requireName(input.name, "Името");
      if (input.kind !== "lathe" && input.kind !== "other") {
        throw new BlondinaInputError("Видът трябва да е струг или друга машина.");
      }
      const result = await pool
        .request()
        .input("name", sql.NVarChar(200), name)
        .input("model", sql.NVarChar(200), text(input.model))
        .input("kind", sql.NVarChar(16), input.kind)
        .input("id", sql.NVarChar(64), id)
        .query("UPDATE dbo.cps_machine SET name = @name, model = @model, kind = @kind WHERE id = @id");
      if (rowsAffected(result) === 0) throw new BlondinaInputError("Няма такава машина.");
    },
    async deleteMachine(id: string) {
      const result = await pool
        .request()
        .input("id", sql.NVarChar(64), requireId(id, "Идентификаторът"))
        .query("DELETE FROM dbo.cps_machine WHERE id = @id");
      if (rowsAffected(result) === 0) throw new BlondinaInputError("Няма такава машина.");
    },
    async createParameter(input: ParameterInput) {
      const id = requireId(input.id, "Идентификаторът");
      const labelText = requireName(input.label, "Името");
      const prepared = prepareParameterWrite(input);
      const existing = await pool
        .request()
        .input("id", sql.NVarChar(64), id)
        .query("SELECT id FROM dbo.cps_parameter WHERE id = @id");
      if (existing.recordset.length > 0) {
        throw new BlondinaInputError("Вече има параметър с този идентификатор.");
      }
      const links = await machineIds(input.machineIds);
      try {
        await withTransaction(pool, async (tx) => {
          await new sql.Request(tx)
            .input("id", sql.NVarChar(64), id)
            .input("label", sql.NVarChar(200), labelText)
            .input("unit", sql.NVarChar(32), text(input.unit) ?? "")
            .input("rangeMin", sql.Float, prepared.rangeMin)
            .input("rangeMax", sql.Float, prepared.rangeMax)
            .input("sampleIntervalSeconds", sql.Int, prepared.sampleIntervalSeconds)
            .input("color", sql.NVarChar(7), prepared.color)
            .input("role", sql.NVarChar(16), prepared.role)
            .query(`
              INSERT INTO dbo.cps_parameter
                (id, label, unit, range_min, range_max, sample_interval_seconds, color, role)
              VALUES (@id, @label, @unit, @rangeMin, @rangeMax, @sampleIntervalSeconds, @color, @role)
            `);
          await replaceLinks(tx, id, links);
          await replaceStates(tx, id, prepared.states);
        });
      } catch (error) {
        if (error instanceof BlondinaInputError) throw error;
        if (sqlErrorNumber(error) === 2627 || sqlErrorNumber(error) === 2601) {
          throw new BlondinaInputError("Вече има параметър с този идентификатор.");
        }
        throw error;
      }
    },
    async updateParameter(input: ParameterInput) {
      const id = requireId(input.id, "Идентификаторът");
      const labelText = requireName(input.label, "Името");
      const prepared = prepareParameterWrite(input);
      const existing = await pool
        .request()
        .input("id", sql.NVarChar(64), id)
        .query("SELECT id FROM dbo.cps_parameter WHERE id = @id");
      if (existing.recordset.length === 0) throw new BlondinaInputError("Няма такъв параметър.");
      const links = await machineIds(input.machineIds);
      await withTransaction(pool, async (tx) => {
        await new sql.Request(tx)
          .input("label", sql.NVarChar(200), labelText)
          .input("unit", sql.NVarChar(32), text(input.unit) ?? "")
          .input("rangeMin", sql.Float, prepared.rangeMin)
          .input("rangeMax", sql.Float, prepared.rangeMax)
          .input("sampleIntervalSeconds", sql.Int, prepared.sampleIntervalSeconds)
          .input("color", sql.NVarChar(7), prepared.color)
          .input("role", sql.NVarChar(16), prepared.role)
          .input("id", sql.NVarChar(64), id)
          .query(`
            UPDATE dbo.cps_parameter
              SET label = @label, unit = @unit, range_min = @rangeMin, range_max = @rangeMax,
                  sample_interval_seconds = @sampleIntervalSeconds, color = @color, role = @role
            WHERE id = @id
          `);
        await replaceLinks(tx, id, links);
        await replaceStates(tx, id, prepared.states);
      });
    },
    async deleteParameter(id: string) {
      const result = await pool
        .request()
        .input("id", sql.NVarChar(64), requireId(id, "Идентификаторът"))
        .query("DELETE FROM dbo.cps_parameter WHERE id = @id");
      if (rowsAffected(result) === 0) throw new BlondinaInputError("Няма такъв параметър.");
    },
    async generate(input, random = Math.random) {
      const fromMs = Date.parse(input.from);
      const toMs = Date.parse(input.to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        throw new BlondinaInputError("Периодът има невалидно време.");
      }
      if (fromMs > toMs) throw new BlondinaInputError("Началото на периода е след края.");
      const statesMap = await loadStatesMap();
      const series = await pool.request().query<SeriesRecord>(`
        SELECT mp.machine_id AS machineId, mp.parameter_id AS parameterId,
               p.range_min AS rangeMin, p.range_max AS rangeMax,
               p.sample_interval_seconds AS sampleIntervalSeconds, p.role AS role
        FROM dbo.cps_machine_parameter mp
        JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
      `);
      const skipped: GenerateResult["skipped"] = [];
      const runnable: Array<{
        machineId: string;
        parameterId: string;
        rangeMin: number;
        rangeMax: number;
        stepMs: number;
        states: ParameterStateDef[];
      }> = [];
      for (const row of series.recordset) {
        const rangeMin = row.rangeMin == null ? null : Number(row.rangeMin);
        const rangeMax = row.rangeMax == null ? null : Number(row.rangeMax);
        const interval = row.sampleIntervalSeconds == null ? null : Number(row.sampleIntervalSeconds);
        const states = statesMap.get(String(row.parameterId)) ?? [];
        const role = parseParameterRole(row.role);
        if (role === "status") {
          if (states.length === 0 || interval == null) {
            skipped.push({
              machineId: String(row.machineId),
              parameterId: String(row.parameterId),
              reason: "липсват състояния или честота",
            });
            continue;
          }
          const fromStates = rangeFromStates(states)!;
          runnable.push({
            machineId: String(row.machineId),
            parameterId: String(row.parameterId),
            rangeMin: fromStates.rangeMin,
            rangeMax: fromStates.rangeMax,
            stepMs: interval * 1000,
            states,
          });
          continue;
        }
        if (rangeMin == null || rangeMax == null || interval == null) {
          skipped.push({
            machineId: String(row.machineId),
            parameterId: String(row.parameterId),
            reason: "липсва диапазон или честота",
          });
          continue;
        }
        runnable.push({
          machineId: String(row.machineId),
          parameterId: String(row.parameterId),
          rangeMin,
          rangeMax,
          stepMs: interval * 1000,
          states: [],
        });
      }
      const estimated = runnable.reduce((sum, item) => sum + Math.floor((toMs - fromMs) / item.stepMs) + 1, 0);
      if (estimated > MAX_GENERATED_ROWS) {
        throw new BlondinaInputError(
          `Периодът дава ${estimated} реда. Скъсете го или увеличете честотата. Таванът е ${MAX_GENERATED_ROWS}.`,
        );
      }
      const pending: Array<{ machineId: string; parameterId: string; measuredAt: string; value: number }> = [];
      for (const item of runnable) {
        if (item.states.length > 0) {
          for (let time = fromMs; time <= toMs; time += item.stepMs) {
            pending.push({
              machineId: item.machineId,
              parameterId: item.parameterId,
              measuredAt: new Date(time).toISOString().slice(0, 23),
              value: pickStateValue(item.states, random),
            });
          }
          continue;
        }
        const span = item.rangeMax - item.rangeMin;
        let current = item.rangeMin + random() * span;
        for (let time = fromMs; time <= toMs; time += item.stepMs) {
          current = nextGeneratedValue(current, item.rangeMin, item.rangeMax, random);
          const value = span === 0 ? item.rangeMin : Math.round(current * 1000) / 1000;
          pending.push({
            machineId: item.machineId,
            parameterId: item.parameterId,
            measuredAt: new Date(time).toISOString().slice(0, 23),
            value,
          });
        }
      }
      if (pending.length > 0) {
        await withTransaction(pool, async (tx) => {
          await upsertMeasurements(tx, pending);
        });
      }
      return { inserted: pending.length, skipped };
    },
    async appendDueSamples(now = new Date(), random = Math.random) {
      const nowMs = now.getTime();
      if (!Number.isFinite(nowMs)) return 0;
      const statesMap = await loadStatesMap();
      const series = await pool.request().query<SeriesRecord>(`
        SELECT mp.machine_id AS machineId, mp.parameter_id AS parameterId,
               p.range_min AS rangeMin, p.range_max AS rangeMax,
               p.sample_interval_seconds AS sampleIntervalSeconds, p.role AS role
        FROM dbo.cps_machine_parameter mp
        JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
        WHERE p.sample_interval_seconds IS NOT NULL
          AND (
            p.role = N'status'
            OR (p.range_min IS NOT NULL AND p.range_max IS NOT NULL)
          )
      `);
      const pending: Array<{ machineId: string; parameterId: string; measuredAt: string; value: number }> = [];
      for (const row of series.recordset) {
        const intervalMs = Number(row.sampleIntervalSeconds) * 1000;
        const last = await pool
          .request()
          .input("machineId", sql.NVarChar(64), String(row.machineId))
          .input("parameterId", sql.NVarChar(64), String(row.parameterId))
          .query<SampleRecord>(`
            SELECT TOP (1) measured_at AS measuredAt, value
            FROM dbo.cps_measurement
            WHERE machine_id = @machineId AND parameter_id = @parameterId
            ORDER BY measured_at DESC
          `);
        const previous = last.recordset[0];
        const lastMs = previous ? Date.parse(iso(previous.measuredAt)) : Number.NaN;
        if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) continue;
        const states = statesMap.get(String(row.parameterId)) ?? [];
        if (parseParameterRole(row.role) === "status") {
          if (states.length === 0) continue;
          pending.push({
            machineId: String(row.machineId),
            parameterId: String(row.parameterId),
            measuredAt: now.toISOString().slice(0, 23),
            value: pickStateValue(states, random),
          });
          continue;
        }
        const rangeMin = Number(row.rangeMin);
        const rangeMax = Number(row.rangeMax);
        const span = rangeMax - rangeMin;
        const previousValue = previous && previous.value != null ? Number(previous.value) : rangeMin + random() * span;
        const next = nextGeneratedValue(previousValue, rangeMin, rangeMax, random);
        const value = span === 0 ? rangeMin : Math.round(next * 1000) / 1000;
        pending.push({
          machineId: String(row.machineId),
          parameterId: String(row.parameterId),
          measuredAt: now.toISOString().slice(0, 23),
          value,
        });
      }
      if (pending.length > 0) {
        await withTransaction(pool, async (tx) => {
          await upsertMeasurements(tx, pending);
        });
      }
      return pending.length;
    },
    async readFirstObject(windowMs: number): Promise<FirstObjectReading> {
      const machineResult = await pool.request().query<MachineRecord>(`
        SELECT TOP (1) id, name, model, kind, created_at AS createdAt
        FROM dbo.cps_machine
        ORDER BY created_at, id
      `);
      const machine = machineResult.recordset[0];
      if (!machine) return { machine: null, charts: [] };
      const parameters = await pool
        .request()
        .input("machineId", sql.NVarChar(64), String(machine.id))
        .query<ParameterRecord>(`
          SELECT TOP (4) p.id AS id, p.label AS label, p.unit AS unit,
                 p.range_min AS rangeMin, p.range_max AS rangeMax,
                 p.sample_interval_seconds AS sampleIntervalSeconds
          FROM dbo.cps_machine_parameter mp
          JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
          WHERE mp.machine_id = @machineId
          ORDER BY p.label
        `);
      const since = new Date(Date.now() - windowMs);
      const charts = [];
      for (const parameter of parameters.recordset) {
        const points = await pool
          .request()
          .input("machineId", sql.NVarChar(64), String(machine.id))
          .input("parameterId", sql.NVarChar(64), String(parameter.id))
          .input("since", sql.DateTime2, since)
          .query<SampleRecord>(`
            SELECT measured_at AS measuredAt, value
            FROM dbo.cps_measurement
            WHERE machine_id = @machineId AND parameter_id = @parameterId AND measured_at >= @since
            ORDER BY measured_at ASC
          `);
        charts.push({
          parameterId: String(parameter.id),
          label: String(parameter.label),
          unit: String(parameter.unit ?? ""),
          writable: parameter.rangeMin != null && parameter.rangeMax != null && parameter.sampleIntervalSeconds != null,
          points: points.recordset.map((point) => ({
            timestamp: iso(point.measuredAt),
            value: point.value == null ? null : Number(point.value),
          })),
        });
      }
      return {
        machine: {
          id: String(machine.id),
          name: String(machine.name),
          model: machine.model == null ? null : String(machine.model),
        },
        charts,
      };
    },
    async readDashboard(windowMs: number): Promise<DashboardReading> {
      const machines = await pool.request().query<MachineRecord>(`
        SELECT id, name, model, kind, created_at AS createdAt
        FROM dbo.cps_machine
        ORDER BY name
      `);
      const statesMap = await loadStatesMap();
      const links = await pool.request().query<{
        machineId: string;
        parameterId: string;
        label: string;
        unit: string | null;
        rangeMin: number | null;
        rangeMax: number | null;
        color: string | null;
        role: string | null;
      }>(`
        SELECT mp.machine_id AS machineId, p.id AS parameterId, p.label AS label,
               p.unit AS unit, p.range_min AS rangeMin, p.range_max AS rangeMax,
               p.color AS color, p.role AS role
        FROM dbo.cps_machine_parameter mp
        JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
        ORDER BY p.label
      `);
      const since = new Date(Date.now() - windowMs);
      const samples = await pool
        .request()
        .input("since", sql.DateTime2, since)
        .query<{
          machineId: string;
          parameterId: string;
          measuredAt: Date | string;
          value: number | null;
        }>(`
          SELECT machine_id AS machineId, parameter_id AS parameterId,
                 measured_at AS measuredAt, value
          FROM dbo.cps_measurement
          WHERE measured_at >= @since
          ORDER BY measured_at ASC
        `);
      return {
        machines: machines.recordset.map((machine) => ({
          id: String(machine.id),
          name: String(machine.name),
          model: machine.model == null ? null : String(machine.model),
          series: links.recordset
            .filter((link) => link.machineId === machine.id)
            .map((link) => {
              const parameterId = String(link.parameterId);
              const label = String(link.label);
              return {
                parameterId,
                label,
                unit: String(link.unit ?? ""),
                rangeMin: link.rangeMin == null ? null : Number(link.rangeMin),
                rangeMax: link.rangeMax == null ? null : Number(link.rangeMax),
                color: link.color == null ? null : String(link.color),
                role: resolveParameterRole(label, parameterId, link.role),
                states: statesMap.get(parameterId) ?? [],
                points: samples.recordset
                  .filter(
                    (sample) => sample.machineId === machine.id && sample.parameterId === parameterId,
                  )
                  .map((sample) => ({
                    timestamp: iso(sample.measuredAt),
                    value: sample.value == null ? null : Number(sample.value),
                  })),
              };
            }),
        })),
      };
    },
    async clearMeasurements() {
      const result = await pool.request().query("DELETE FROM dbo.cps_measurement");
      return rowsAffected(result);
    },
    async listMeasurements(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 40, 1), 200);
      const request = pool.request().input("limit", sql.Int, limit);
      const rows = filter.machineId
        ? await request.input("machineId", sql.NVarChar(64), filter.machineId).query<MeasurementRecord>(`
            SELECT TOP (@limit) m.id AS machineId, m.name AS machineName,
                   p.id AS parameterId, p.label AS parameterLabel, p.unit AS unit,
                   s.measured_at AS measuredAt, s.value AS value
            FROM dbo.cps_measurement s
            JOIN dbo.cps_machine m ON m.id = s.machine_id
            JOIN dbo.cps_parameter p ON p.id = s.parameter_id
            WHERE s.machine_id = @machineId
            ORDER BY s.measured_at DESC
          `)
        : await request.query<MeasurementRecord>(`
            SELECT TOP (@limit) m.id AS machineId, m.name AS machineName,
                   p.id AS parameterId, p.label AS parameterLabel, p.unit AS unit,
                   s.measured_at AS measuredAt, s.value AS value
            FROM dbo.cps_measurement s
            JOIN dbo.cps_machine m ON m.id = s.machine_id
            JOIN dbo.cps_parameter p ON p.id = s.parameter_id
            ORDER BY s.measured_at DESC
          `);
      return rows.recordset.map((row) => ({
        machineId: String(row.machineId),
        machineName: String(row.machineName),
        parameterId: String(row.parameterId),
        parameterLabel: String(row.parameterLabel),
        unit: String(row.unit ?? ""),
        measuredAt: iso(row.measuredAt),
        value: row.value == null ? null : Number(row.value),
      }));
    },
    async close() {
      await pool.close();
    },
  };
}
