import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sql, { type ConnectionPool, type IResult, type Transaction } from "mssql";
import {
  asAggregateMethod,
  resolveAggregateMethod,
  type AggregateMethod,
} from "../domain/aggregateMethod";
import {
  parseParameterRole,
  parseStates,
  rangeFromStates,
} from "../domain/normalizeParameterStates";
import { resolveParameterRole, type ParameterStateDef } from "../domain/parameterRole";
import { effectiveSampleIntervalMs } from "../config/dashboard";
import {
  BlondinaInputError,
  nextGeneratedValue,
  normalizeColor,
  normalizeFormulaText,
  normalizeRange,
  normalizeStatusComment,
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
  type ManualMachineStatus,
  type ParameterInput,
  type ParameterRole,
  type ParameterRow,
  type StatusEventRow,
} from "./blondina";
import { getSampleSpeedFactor } from "./sampleSpeedFactor";

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
  aggregateMethod: string | null;
  formula: string | null;
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
    IF COL_LENGTH('dbo.cps_parameter', 'aggregate_method') IS NULL
      ALTER TABLE dbo.cps_parameter ADD aggregate_method nvarchar(16) NULL;
    IF COL_LENGTH('dbo.cps_parameter', 'formula') IS NULL
      ALTER TABLE dbo.cps_parameter ADD formula nvarchar(1000) NULL;
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
    IF OBJECT_ID(N'dbo.cps_status_event', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.cps_status_event (
        id            INT           NOT NULL IDENTITY(1, 1)
          CONSTRAINT PK_cps_status_event PRIMARY KEY,
        machine_id    NVARCHAR(64)  NOT NULL,
        parameter_id  NVARCHAR(64)  NOT NULL,
        status_value  FLOAT         NOT NULL,
        comment       NVARCHAR(2000) NOT NULL
          CONSTRAINT DF_cps_status_event_comment DEFAULT (N''),
        kind          NVARCHAR(32)  NOT NULL,
        created_at    DATETIME2     NOT NULL,
        CONSTRAINT FK_cps_status_event_machine FOREIGN KEY (machine_id)
          REFERENCES dbo.cps_machine (id) ON DELETE CASCADE,
        CONSTRAINT FK_cps_status_event_parameter FOREIGN KEY (parameter_id)
          REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE,
        CONSTRAINT CK_cps_status_event_kind CHECK (
          kind IN (N'status_change', N'comment_update')
        )
      );
      CREATE INDEX cps_status_event_machine_time
        ON dbo.cps_status_event (machine_id, created_at DESC);
    END
  `);

  function stateMatching(states: ParameterStateDef[], value: number): ParameterStateDef | null {
    return states.find((state) => state.value === value) ?? null;
  }

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

  function normalizeAggregateMethodWrite(
    value: unknown,
    role: ParameterRole,
  ): AggregateMethod | null {
    if (role === "status" || role === "formula") return null;
    if (value == null || String(value).trim() === "") return null;
    const method = asAggregateMethod(value);
    if (!method) {
      throw new BlondinaInputError(
        "Агрегирането трябва да е sum, avg, last, min, max или count.",
      );
    }
    return method;
  }

  function prepareParameterWrite(input: ParameterInput): {
    role: ParameterRole;
    states: ParameterStateDef[];
    rangeMin: number | null;
    rangeMax: number | null;
    sampleIntervalSeconds: number | null;
    color: string | null;
    aggregateMethod: AggregateMethod | null;
    formula: string | null;
  } {
    const role = parseParameterRole(input.role);
    const parsed = parseStates(input.states, role);
    if (parsed.error) throw new BlondinaInputError(parsed.error);
    const states = parsed.states;
    const formula = normalizeFormulaText(input.formula, role);
    const range = normalizeRange(
      numberOrNull(input.rangeMin),
      numberOrNull(input.rangeMax),
      numberOrNull(input.sampleIntervalSeconds),
    );
    if (role === "status") {
      const fromStates = rangeFromStates(states);
      if (!fromStates) throw new BlondinaInputError("Статусният параметър трябва да има състояния.");
      return {
        role,
        states,
        rangeMin: fromStates.rangeMin,
        rangeMax: fromStates.rangeMax,
        // Frequency unused: status is set manually on the табло, never auto-generated.
        sampleIntervalSeconds: range.sampleIntervalSeconds,
        color: null,
        aggregateMethod: null,
        formula: null,
      };
    }
    if (role === "formula") {
      if (range.rangeMin == null || range.rangeMax == null) {
        throw new BlondinaInputError(
          "Формулата трябва да има граници (От/До) за общата графика на таблото.",
        );
      }
      return {
        role,
        states: [],
        rangeMin: range.rangeMin,
        rangeMax: range.rangeMax,
        sampleIntervalSeconds: range.sampleIntervalSeconds,
        color: normalizeColor(input.color),
        aggregateMethod: null,
        formula,
      };
    }
    return {
      role,
      states: [],
      rangeMin: range.rangeMin,
      rangeMax: range.rangeMax,
      sampleIntervalSeconds: range.sampleIntervalSeconds,
      color: normalizeColor(input.color),
      aggregateMethod: normalizeAggregateMethodWrite(input.aggregateMethod, role),
      formula: null,
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
             sample_interval_seconds AS sampleIntervalSeconds, color, role,
             aggregate_method AS aggregateMethod, formula
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
      const unit = String(row.unit ?? "");
      return {
        id,
        label,
        unit,
        rangeMin: row.rangeMin == null ? null : Number(row.rangeMin),
        rangeMax: row.rangeMax == null ? null : Number(row.rangeMax),
        sampleIntervalSeconds: row.sampleIntervalSeconds == null ? null : Number(row.sampleIntervalSeconds),
        color: row.color == null ? null : String(row.color),
        role: resolveParameterRole(label, id, row.role),
        aggregateMethod: resolveAggregateMethod(label, id, unit, row.aggregateMethod),
        formula: row.formula == null ? null : String(row.formula),
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
            .input("aggregateMethod", sql.NVarChar(16), prepared.aggregateMethod)
            .input("formula", sql.NVarChar(1000), prepared.formula)
            .query(`
              INSERT INTO dbo.cps_parameter
                (id, label, unit, range_min, range_max, sample_interval_seconds, color, role, aggregate_method, formula)
              VALUES (@id, @label, @unit, @rangeMin, @rangeMax, @sampleIntervalSeconds, @color, @role, @aggregateMethod, @formula)
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
          .input("aggregateMethod", sql.NVarChar(16), prepared.aggregateMethod)
          .input("formula", sql.NVarChar(1000), prepared.formula)
          .input("id", sql.NVarChar(64), id)
          .query(`
            UPDATE dbo.cps_parameter
              SET label = @label, unit = @unit, range_min = @rangeMin, range_max = @rangeMax,
                  sample_interval_seconds = @sampleIntervalSeconds, color = @color, role = @role,
                  aggregate_method = @aggregateMethod, formula = @formula
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
      }> = [];
      for (const row of series.recordset) {
        const rangeMin = row.rangeMin == null ? null : Number(row.rangeMin);
        const rangeMax = row.rangeMax == null ? null : Number(row.rangeMax);
        const interval = row.sampleIntervalSeconds == null ? null : Number(row.sampleIntervalSeconds);
        const role = parseParameterRole(row.role);
        if (role === "status") {
          skipped.push({
            machineId: String(row.machineId),
            parameterId: String(row.parameterId),
            reason: "статусът се задава ръчно от таблото",
          });
          continue;
        }
        if (role === "formula") {
          skipped.push({
            machineId: String(row.machineId),
            parameterId: String(row.parameterId),
            reason: "формулата се смята на общата графика",
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
    async appendDueSamples(
      now = new Date(),
      random = Math.random,
      speedFactor = getSampleSpeedFactor(),
    ) {
      const nowMs = now.getTime();
      if (!Number.isFinite(nowMs)) return 0;
      const series = await pool.request().query<SeriesRecord>(`
        SELECT mp.machine_id AS machineId, mp.parameter_id AS parameterId,
               p.range_min AS rangeMin, p.range_max AS rangeMax,
               p.sample_interval_seconds AS sampleIntervalSeconds, p.role AS role
        FROM dbo.cps_machine_parameter mp
        JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
        WHERE p.sample_interval_seconds IS NOT NULL
          AND p.range_min IS NOT NULL AND p.range_max IS NOT NULL
          AND ISNULL(p.role, N'metric') <> N'status'
          AND ISNULL(p.role, N'metric') <> N'formula'
      `);
      const pending: Array<{ machineId: string; parameterId: string; measuredAt: string; value: number }> = [];
      for (const row of series.recordset) {
        const role = parseParameterRole(row.role);
        if (role === "status" || role === "formula") continue;
        const intervalMs = effectiveSampleIntervalMs(Number(row.sampleIntervalSeconds), speedFactor);
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
    async setMachineStatus(input, now = new Date()) {
      const machineId = requireId(input.machineId, "Идентификаторът на машината");
      const machine = await pool
        .request()
        .input("id", sql.NVarChar(64), machineId)
        .query("SELECT id FROM dbo.cps_machine WHERE id = @id");
      if (machine.recordset.length === 0) throw new BlondinaInputError(`Няма машина ${machineId}.`);
      const link = await pool
        .request()
        .input("machineId", sql.NVarChar(64), machineId)
        .query<{ parameterId: string }>(`
          SELECT TOP (1) p.id AS parameterId
          FROM dbo.cps_machine_parameter mp
          JOIN dbo.cps_parameter p ON p.id = mp.parameter_id
          WHERE mp.machine_id = @machineId AND p.role = N'status'
          ORDER BY p.label
        `);
      const parameterId = link.recordset[0]?.parameterId;
      if (!parameterId) {
        throw new BlondinaInputError("На машината няма присвоен статус параметър.");
      }
      const states = (await loadStatesMap()).get(String(parameterId)) ?? [];
      const value = numberOrNull(input.value);
      if (value == null) throw new BlondinaInputError("Стойността на статуса е задължителна.");
      const state = stateMatching(states, value);
      if (!state) {
        throw new BlondinaInputError("Стойността не е сред дефинираните състояния.");
      }
      const previous = await pool
        .request()
        .input("machineId", sql.NVarChar(64), machineId)
        .query<{ comment: string }>(`
          SELECT TOP (1) comment
          FROM dbo.cps_status_event
          WHERE machine_id = @machineId
          ORDER BY created_at DESC, id DESC
        `);
      const comment =
        input.comment === undefined
          ? previous.recordset[0]
            ? String(previous.recordset[0].comment ?? "")
            : ""
          : normalizeStatusComment(input.comment);
      const createdAt = now.toISOString().slice(0, 23);
      await withTransaction(pool, async (tx) => {
        await upsertMeasurements(tx, [
          {
            machineId,
            parameterId: String(parameterId),
            measuredAt: createdAt,
            value,
          },
        ]);
        await new sql.Request(tx)
          .input("machineId", sql.NVarChar(64), machineId)
          .input("parameterId", sql.NVarChar(64), String(parameterId))
          .input("statusValue", sql.Float, value)
          .input("comment", sql.NVarChar(2000), comment)
          .input("kind", sql.NVarChar(32), "status_change")
          .input("createdAt", sql.DateTime2, new Date(createdAt))
          .query(`
            INSERT INTO dbo.cps_status_event
              (machine_id, parameter_id, status_value, comment, kind, created_at)
            VALUES (@machineId, @parameterId, @statusValue, @comment, @kind, @createdAt)
          `);
      });
      return {
        parameterId: String(parameterId),
        value: state.value,
        label: state.label,
        color: state.color,
        comment,
        updatedAt: new Date(createdAt).toISOString(),
      };
    },
    async setMachineStatusComment(input, now = new Date()) {
      const machineId = requireId(input.machineId, "Идентификаторът на машината");
      const machine = await pool
        .request()
        .input("id", sql.NVarChar(64), machineId)
        .query("SELECT id FROM dbo.cps_machine WHERE id = @id");
      if (machine.recordset.length === 0) throw new BlondinaInputError(`Няма машина ${machineId}.`);
      const comment = normalizeStatusComment(input.comment);
      const latest = await pool
        .request()
        .input("machineId", sql.NVarChar(64), machineId)
        .query<{ parameterId: string; statusValue: number }>(`
          SELECT TOP (1) parameter_id AS parameterId, status_value AS statusValue
          FROM dbo.cps_status_event
          WHERE machine_id = @machineId
          ORDER BY created_at DESC, id DESC
        `);
      let parameterId: string;
      let value: number;
      if (latest.recordset[0]) {
        parameterId = String(latest.recordset[0].parameterId);
        value = Number(latest.recordset[0].statusValue);
      } else {
        const measurement = await pool
          .request()
          .input("machineId", sql.NVarChar(64), machineId)
          .query<{ parameterId: string; value: number }>(`
            SELECT TOP (1) m.parameter_id AS parameterId, m.value AS value
            FROM dbo.cps_measurement m
            JOIN dbo.cps_parameter p ON p.id = m.parameter_id
            WHERE m.machine_id = @machineId AND p.role = N'status' AND m.value IS NOT NULL
            ORDER BY m.measured_at DESC
          `);
        if (!measurement.recordset[0]) {
          throw new BlondinaInputError("Първо задайте статус, после коментар.");
        }
        parameterId = String(measurement.recordset[0].parameterId);
        value = Number(measurement.recordset[0].value);
      }
      const states = (await loadStatesMap()).get(parameterId) ?? [];
      const state = stateMatching(states, value);
      if (!state) {
        throw new BlondinaInputError("Текущият статус не съвпада с дефинираните състояния.");
      }
      const createdAt = now.toISOString().slice(0, 23);
      await pool
        .request()
        .input("machineId", sql.NVarChar(64), machineId)
        .input("parameterId", sql.NVarChar(64), parameterId)
        .input("statusValue", sql.Float, value)
        .input("comment", sql.NVarChar(2000), comment)
        .input("kind", sql.NVarChar(32), "comment_update")
        .input("createdAt", sql.DateTime2, new Date(createdAt))
        .query(`
          INSERT INTO dbo.cps_status_event
            (machine_id, parameter_id, status_value, comment, kind, created_at)
          VALUES (@machineId, @parameterId, @statusValue, @comment, @kind, @createdAt)
        `);
      return {
        parameterId,
        value: state.value,
        label: state.label,
        color: state.color,
        comment,
        updatedAt: new Date(createdAt).toISOString(),
      };
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
        aggregateMethod: string | null;
        sampleIntervalSeconds: number | null;
        formula: string | null;
      }>(`
        SELECT mp.machine_id AS machineId, p.id AS parameterId, p.label AS label,
               p.unit AS unit, p.range_min AS rangeMin, p.range_max AS rangeMax,
               p.color AS color, p.role AS role,
               p.aggregate_method AS aggregateMethod,
               p.sample_interval_seconds AS sampleIntervalSeconds,
               p.formula AS formula
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
      const latestEvents = await pool.request().query<{
        machineId: string;
        parameterId: string;
        statusValue: number;
        comment: string;
        createdAt: Date | string;
      }>(`
        SELECT e.machine_id AS machineId, e.parameter_id AS parameterId,
               e.status_value AS statusValue, e.comment AS comment,
               e.created_at AS createdAt
        FROM dbo.cps_status_event e
        INNER JOIN (
          SELECT machine_id, MAX(id) AS maxId
          FROM dbo.cps_status_event
          GROUP BY machine_id
        ) latest ON latest.maxId = e.id
      `);
      const latestByMachine = new Map(
        latestEvents.recordset.map((row) => [
          String(row.machineId),
          {
            parameterId: String(row.parameterId),
            value: Number(row.statusValue),
            comment: String(row.comment ?? ""),
            updatedAt: iso(row.createdAt),
          },
        ]),
      );
      const statusEventQuery = await pool
        .request()
        .input("since", sql.DateTime2, since)
        .query<{
          id: number;
          machineId: string;
          machineName: string;
          parameterId: string;
          parameterLabel: string;
          statusValue: number;
          comment: string;
          kind: string;
          createdAt: Date | string;
        }>(`
          SELECT e.id AS id, e.machine_id AS machineId, m.name AS machineName,
                 e.parameter_id AS parameterId, p.label AS parameterLabel,
                 e.status_value AS statusValue, e.comment AS comment,
                 e.kind AS kind, e.created_at AS createdAt
          FROM dbo.cps_status_event e
          JOIN dbo.cps_machine m ON m.id = e.machine_id
          JOIN dbo.cps_parameter p ON p.id = e.parameter_id
          WHERE e.created_at >= @since
          ORDER BY e.created_at DESC, e.id DESC
        `);
      const statusEvents: StatusEventRow[] = statusEventQuery.recordset.map((row) => {
        const parameterId = String(row.parameterId);
        const value = Number(row.statusValue);
        const state = stateMatching(statesMap.get(parameterId) ?? [], value);
        const kind = String(row.kind) === "comment_update" ? "comment_update" : "status_change";
        return {
          id: Number(row.id),
          machineId: String(row.machineId),
          machineName: String(row.machineName),
          parameterId,
          parameterLabel: String(row.parameterLabel),
          value,
          stateLabel: state?.label ?? String(value),
          color: state?.color ?? "#929292",
          comment: String(row.comment ?? ""),
          kind,
          createdAt: iso(row.createdAt),
        };
      });
      return {
        machines: machines.recordset.map((machine) => {
          const machineId = String(machine.id);
          const series = links.recordset
            .filter((link) => link.machineId === machine.id)
            .map((link) => {
              const parameterId = String(link.parameterId);
              const label = String(link.label);
              const unit = String(link.unit ?? "");
              return {
                parameterId,
                label,
                unit,
                rangeMin: link.rangeMin == null ? null : Number(link.rangeMin),
                rangeMax: link.rangeMax == null ? null : Number(link.rangeMax),
                color: link.color == null ? null : String(link.color),
                role: resolveParameterRole(label, parameterId, link.role),
                aggregateMethod: resolveAggregateMethod(
                  label,
                  parameterId,
                  unit,
                  link.aggregateMethod,
                ),
                sampleIntervalSeconds:
                  link.sampleIntervalSeconds == null
                    ? null
                    : Number(link.sampleIntervalSeconds),
                formula: link.formula == null ? null : String(link.formula),
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
            });
          const latest = latestByMachine.get(machineId);
          let manualStatus: ManualMachineStatus | null = null;
          if (latest) {
            const state = stateMatching(statesMap.get(latest.parameterId) ?? [], latest.value);
            if (state) {
              manualStatus = {
                parameterId: latest.parameterId,
                value: state.value,
                label: state.label,
                color: state.color,
                comment: latest.comment,
                updatedAt: latest.updatedAt,
              };
            }
          } else {
            const statusSeries = series.find((item) => item.role === "status" && item.states.length > 0);
            const lastPoint = statusSeries?.points.length
              ? statusSeries.points[statusSeries.points.length - 1]
              : null;
            if (statusSeries && lastPoint && lastPoint.value != null) {
              const state = stateMatching(statusSeries.states, lastPoint.value);
              if (state) {
                manualStatus = {
                  parameterId: statusSeries.parameterId,
                  value: state.value,
                  label: state.label,
                  color: state.color,
                  comment: "",
                  updatedAt: lastPoint.timestamp,
                };
              }
            }
          }
          return {
            id: machineId,
            name: String(machine.name),
            model: machine.model == null ? null : String(machine.model),
            series,
            manualStatus,
          };
        }),
        statusEvents,
      };
    },
    async clearMeasurements(machineId) {
      const id = machineId?.trim() ?? "";
      if (id) {
        const machine = await pool
          .request()
          .input("id", sql.NVarChar(64), id)
          .query("SELECT id FROM dbo.cps_machine WHERE id = @id");
        if (machine.recordset.length === 0) throw new BlondinaInputError(`Няма машина ${id}.`);
        const result = await pool
          .request()
          .input("machineId", sql.NVarChar(64), id)
          .query("DELETE FROM dbo.cps_measurement WHERE machine_id = @machineId");
        return rowsAffected(result);
      }
      const result = await pool.request().query("DELETE FROM dbo.cps_measurement");
      return rowsAffected(result);
    },
    async listMeasurements(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 40, 1), 200);
      const request = pool.request().input("limit", sql.Int, limit);
      const clauses: string[] = [];
      if (filter.machineId) {
        request.input("machineId", sql.NVarChar(64), filter.machineId);
        clauses.push("s.machine_id = @machineId");
      }
      if (filter.parameterId) {
        request.input("parameterId", sql.NVarChar(64), filter.parameterId);
        clauses.push("s.parameter_id = @parameterId");
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await request.query<MeasurementRecord>(`
        SELECT TOP (@limit) m.id AS machineId, m.name AS machineName,
               p.id AS parameterId, p.label AS parameterLabel, p.unit AS unit,
               s.measured_at AS measuredAt, s.value AS value
        FROM dbo.cps_measurement s
        JOIN dbo.cps_machine m ON m.id = s.machine_id
        JOIN dbo.cps_parameter p ON p.id = s.parameter_id
        ${where}
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
