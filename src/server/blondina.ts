import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  parseParameterRole,
  parseStates,
  rangeFromStates,
} from "../domain/normalizeParameterStates";
import {
  asAggregateMethod,
  resolveAggregateMethod,
  type AggregateMethod,
} from "../domain/aggregateMethod";
import {
  resolveParameterRole,
  type ParameterRole,
  type ParameterStateDef,
} from "../domain/parameterRole";
import { effectiveSampleIntervalMs } from "../config/dashboard";
import { getSampleSpeedFactor } from "./sampleSpeedFactor";

export type { AggregateMethod };

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const MAX_GENERATED_ROWS = 20_000;

export class BlondinaInputError extends Error {}

export type MachineKind = "lathe" | "other";
export type { ParameterRole, ParameterStateDef };

export type MachineInput = {
  id: string;
  name: string;
  model?: string | null;
  kind: MachineKind;
};

export type ParameterInput = {
  id: string;
  label: string;
  unit?: string | null;
  rangeMin?: number | null;
  rangeMax?: number | null;
  sampleIntervalSeconds?: number | null;
  color?: string | null;
  role?: ParameterRole | string | null;
  /** Cross-machine aggregate on the табло panel. Null → inferred default. */
  aggregateMethod?: AggregateMethod | string | null;
  states?: ParameterStateDef[];
  machineIds: string[];
};

export type MachineRow = {
  id: string;
  name: string;
  model: string | null;
  kind: MachineKind;
  createdAt: string;
};

export type ParameterRow = {
  id: string;
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  sampleIntervalSeconds: number | null;
  color: string | null;
  role: ParameterRole;
  aggregateMethod: AggregateMethod;
  states: ParameterStateDef[];
  machineIds: string[];
};

export type MeasurementRow = {
  machineId: string;
  machineName: string;
  parameterId: string;
  parameterLabel: string;
  unit: string;
  measuredAt: string;
  value: number | null;
};

export type BlondinaState = {
  dbPath: string;
  machines: MachineRow[];
  parameters: ParameterRow[];
  measurementCount: number;
};

export type GenerateResult = {
  inserted: number;
  skipped: Array<{ machineId: string; parameterId: string; reason: string }>;
};

export type ChartSeries = {
  parameterId: string;
  label: string;
  unit: string;
  writable: boolean;
  points: Array<{ timestamp: string; value: number | null }>;
};

export type FirstObjectReading = {
  machine: { id: string; name: string; model: string | null } | null;
  charts: ChartSeries[];
};

export type DashboardSeries = {
  parameterId: string;
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  color: string | null;
  role: ParameterRole;
  aggregateMethod: AggregateMethod;
  sampleIntervalSeconds: number | null;
  states: ParameterStateDef[];
  points: Array<{ timestamp: string; value: number | null }>;
};

export type StatusEventKind = "status_change" | "comment_update";

/** Latest operator-set status for a machine on the табло. */
export type ManualMachineStatus = {
  parameterId: string;
  value: number;
  label: string;
  color: string;
  comment: string;
  updatedAt: string;
};

export type StatusEventRow = {
  id: number;
  machineId: string;
  machineName: string;
  parameterId: string;
  parameterLabel: string;
  value: number;
  stateLabel: string;
  color: string;
  comment: string;
  kind: StatusEventKind;
  createdAt: string;
};

export type DashboardMachine = {
  id: string;
  name: string;
  model: string | null;
  series: DashboardSeries[];
  manualStatus: ManualMachineStatus | null;
};

export type DashboardReading = {
  machines: DashboardMachine[];
  statusEvents: StatusEventRow[];
};

export type SetMachineStatusInput = {
  machineId: string;
  value: number;
  /** When omitted on status change, previous comment is kept. */
  comment?: string | null;
};

export type SetMachineStatusCommentInput = {
  machineId: string;
  comment: string;
};

export type Blondina = {
  kind: "sqlite" | "sqlserver";
  path: string;
  getState: () => BlondinaState;
  createMachine: (input: MachineInput) => void;
  updateMachine: (input: MachineInput) => void;
  deleteMachine: (id: string) => void;
  createParameter: (input: ParameterInput) => void;
  updateParameter: (input: ParameterInput) => void;
  deleteParameter: (id: string) => void;
  generate: (input: { from: string; to: string }, random?: () => number) => GenerateResult;
  appendDueSamples: (now?: Date, random?: () => number, speedFactor?: number) => number;
  setMachineStatus: (input: SetMachineStatusInput, now?: Date) => ManualMachineStatus;
  setMachineStatusComment: (input: SetMachineStatusCommentInput, now?: Date) => ManualMachineStatus;
  readFirstObject: (windowMs: number) => FirstObjectReading;
  readDashboard: (windowMs: number) => DashboardReading;
  clearMeasurements: (machineId?: string) => number;
  listMeasurements: (filter?: { machineId?: string; limit?: number }) => MeasurementRow[];
  close: () => void;
};

export type AsyncBlondina = {
  [K in keyof Blondina]: Blondina[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : Blondina[K];
};

const STARTER_MACHINES: MachineInput[] = [
  { id: "LATHE_01", name: "Струг 1", model: "DMG MORI NLX 2500", kind: "lathe" },
  { id: "LATHE_02", name: "Струг 2", model: null, kind: "lathe" },
  { id: "MACH_03", name: "Машина 3", model: null, kind: "other" },
  { id: "MACH_04", name: "Машина 4", model: null, kind: "other" },
];

const STARTER_PARAMETERS: ParameterInput[] = [
  { id: "spindle_speed", label: "Скорост на въртене", unit: "об/мин", machineIds: [] },
  { id: "idle_time", label: "Празен ход", unit: "сек", machineIds: [] },
  { id: "good_count", label: "Годни детайли", unit: "бр", machineIds: [] },
  { id: "scrap_count", label: "Брак", unit: "бр", machineIds: [] },
];

function schemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "../../db/001_cps_schema.sql"), "utf8");
}

function changedRows(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new BlondinaInputError("Числовата стойност е невалидна.");
  }
  return numeric;
}

export function requireId(value: string, label: string): string {
  const id = value.trim();
  if (!ID_PATTERN.test(id)) {
    throw new BlondinaInputError(
      `${label} трябва да започва с буква и да съдържа само латински букви, цифри и _.`,
    );
  }
  return id;
}

export function requireName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new BlondinaInputError(`${label} е задължително.`);
  return name;
}

export function normalizeRange(min: number | null, max: number | null, interval: number | null): {
  rangeMin: number | null;
  rangeMax: number | null;
  sampleIntervalSeconds: number | null;
} {
  if ((min == null) !== (max == null)) {
    throw new BlondinaInputError("Попълнете и двете граници на диапазона, или оставете и двете празни.");
  }
  if (min != null && max != null && min > max) {
    throw new BlondinaInputError("Долната граница не може да е по-голяма от горната.");
  }
  if (interval == null) return { rangeMin: min, rangeMax: max, sampleIntervalSeconds: null };
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new BlondinaInputError("Честотата трябва да е цяло число секунди, по-голямо от нула.");
  }
  return { rangeMin: min, rangeMax: max, sampleIntervalSeconds: interval };
}

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function normalizeColor(value: unknown): string | null {
  if (value == null) return null;
  const color = String(value).trim();
  if (!color) return null;
  if (!COLOR_PATTERN.test(color)) {
    throw new BlondinaInputError("Цветът се записва като #929292.");
  }
  if (color.toLowerCase() === "#ff0000") {
    throw new BlondinaInputError(
      "Чистият червен #FF0000 е запазен за стойности извън границите на таблото.",
    );
  }
  return color.toLowerCase();
}

/** Chance a generated sample may leave [min, max] (still within ±20% slack). */
export const GENERATED_OUTSIDE_CHANCE = 0.08;

/**
 * Random walk around the configured range. Most samples stay in-range;
 * a small fraction may go up to 20% outside for OOR testing on the табло.
 */
export function nextGeneratedValue(current: number, min: number, max: number, random: () => number): number {
  const span = max - min;
  if (span === 0) return min;
  const step = current + (random() - 0.5) * span * 0.35;
  const allowOutside = random() < GENERATED_OUTSIDE_CHANCE;
  if (allowOutside) {
    const slack = span * 0.2;
    return Math.min(max + slack, Math.max(min - slack, step));
  }
  return Math.min(max, Math.max(min, step));
}

function machineIds(db: DatabaseSync, ids: string[]): string[] {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) {
    const row = db.prepare("SELECT id FROM cps_machine WHERE id = ?").get(id);
    if (!row) throw new BlondinaInputError(`Няма машина ${id}.`);
  }
  return unique;
}

function replaceLinks(db: DatabaseSync, parameterId: string, ids: string[]): void {
  db.prepare("DELETE FROM cps_machine_parameter WHERE parameter_id = ?").run(parameterId);
  const insert = db.prepare(
    "INSERT INTO cps_machine_parameter (machine_id, parameter_id) VALUES (?, ?)",
  );
  for (const machineId of ids) insert.run(machineId, parameterId);
}

function seed(db: DatabaseSync): void {
  const count = db.prepare("SELECT COUNT(*) AS count FROM cps_machine").get();
  if (Number(count?.count ?? 0) > 0) return;
  const insertMachine = db.prepare(
    "INSERT INTO cps_machine (id, name, model, kind) VALUES (?, ?, ?, ?)",
  );
  for (const machine of STARTER_MACHINES) {
    insertMachine.run(machine.id, machine.name, machine.model ?? null, machine.kind);
  }
  const insertParameter = db.prepare(
    "INSERT INTO cps_parameter (id, label, unit) VALUES (?, ?, ?)",
  );
  const insertLink = db.prepare(
    "INSERT INTO cps_machine_parameter (machine_id, parameter_id) VALUES (?, ?)",
  );
  for (const parameter of STARTER_PARAMETERS) {
    insertParameter.run(parameter.id, parameter.label, parameter.unit ?? "");
    for (const machine of STARTER_MACHINES) insertLink.run(machine.id, parameter.id);
  }
}

function ensureColorColumn(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(cps_parameter)").all();
  if (columns.some((column) => column.name === "color")) return;
  db.exec("ALTER TABLE cps_parameter ADD COLUMN color TEXT");
}

function ensureRoleAndStates(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(cps_parameter)").all();
  if (!columns.some((column) => column.name === "role")) {
    db.exec("ALTER TABLE cps_parameter ADD COLUMN role TEXT NOT NULL DEFAULT 'metric'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cps_parameter_state (
      parameter_id  TEXT NOT NULL REFERENCES cps_parameter (id) ON DELETE CASCADE,
      value         REAL NOT NULL,
      label         TEXT NOT NULL,
      color         TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (parameter_id, value)
    )
  `);
}

function ensureAggregateMethodColumn(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(cps_parameter)").all();
  if (columns.some((column) => column.name === "aggregate_method")) return;
  db.exec("ALTER TABLE cps_parameter ADD COLUMN aggregate_method TEXT");
}

function ensureStatusEventTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cps_status_event (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id    TEXT NOT NULL REFERENCES cps_machine (id) ON DELETE CASCADE,
      parameter_id  TEXT NOT NULL REFERENCES cps_parameter (id) ON DELETE CASCADE,
      status_value  REAL NOT NULL,
      comment       TEXT NOT NULL DEFAULT '',
      kind          TEXT NOT NULL CHECK (kind IN ('status_change', 'comment_update')),
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cps_status_event_machine_time
      ON cps_status_event (machine_id, created_at DESC);
  `);
}

const MAX_STATUS_COMMENT_LENGTH = 2000;

export function normalizeStatusComment(value: unknown): string {
  const comment = value == null ? "" : String(value);
  if (comment.length > MAX_STATUS_COMMENT_LENGTH) {
    throw new BlondinaInputError(
      `Коментарът е твърде дълъг (таван ${MAX_STATUS_COMMENT_LENGTH} знака).`,
    );
  }
  return comment;
}

function stateMatching(
  states: ParameterStateDef[],
  value: number,
): ParameterStateDef | null {
  const exact = states.find((state) => state.value === value);
  if (exact) return exact;
  return null;
}

function normalizeAggregateMethodWrite(
  value: unknown,
  role: ParameterRole,
): AggregateMethod | null {
  if (role === "status") return null;
  if (value == null || String(value).trim() === "") return null;
  const method = asAggregateMethod(value);
  if (!method) {
    throw new BlondinaInputError(
      "Агрегирането трябва да е sum, avg, last, min, max или count.",
    );
  }
  return method;
}

function replaceStates(db: DatabaseSync, parameterId: string, states: ParameterStateDef[]): void {
  db.prepare("DELETE FROM cps_parameter_state WHERE parameter_id = ?").run(parameterId);
  const insert = db.prepare(
    `INSERT INTO cps_parameter_state (parameter_id, value, label, color, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  );
  states.forEach((state, index) => {
    insert.run(parameterId, state.value, state.label, state.color, index);
  });
}

function loadStatesMap(db: DatabaseSync): Map<string, ParameterStateDef[]> {
  const rows = db
    .prepare(
      `SELECT parameter_id AS parameterId, value, label, color, sort_order AS sortOrder
       FROM cps_parameter_state
       ORDER BY parameter_id, sort_order, value`,
    )
    .all();
  const map = new Map<string, ParameterStateDef[]>();
  for (const row of rows) {
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

function prepareParameterWrite(input: ParameterInput): {
  role: ParameterRole;
  states: ParameterStateDef[];
  rangeMin: number | null;
  rangeMax: number | null;
  sampleIntervalSeconds: number | null;
  color: string | null;
  aggregateMethod: AggregateMethod | null;
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
    return {
      role,
      states,
      rangeMin: fromStates.rangeMin,
      rangeMax: fromStates.rangeMax,
      // Frequency unused: status is set manually on the табло, never auto-generated.
      sampleIntervalSeconds: range.sampleIntervalSeconds,
      color: null,
      aggregateMethod: null,
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
  };
}

export function openBlondina(dbPath: string): Blondina {
  const db = new DatabaseSync(dbPath);
  db.exec(schemaSql());
  db.exec("PRAGMA foreign_keys = ON");
  ensureColorColumn(db);
  ensureRoleAndStates(db);
  ensureAggregateMethodColumn(db);
  ensureStatusEventTable(db);
  seed(db);

  const listMachines = (): MachineRow[] =>
    db
      .prepare(
        `SELECT id, name, model, kind, created_at AS createdAt
         FROM cps_machine
         ORDER BY name`,
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        model: row.model == null ? null : String(row.model),
        kind: row.kind === "lathe" ? "lathe" : "other",
        createdAt: String(row.createdAt),
      }));

  const listParameters = (): ParameterRow[] => {
    const parameters = db
      .prepare(
        `SELECT id, label, unit, range_min AS rangeMin, range_max AS rangeMax,
                sample_interval_seconds AS sampleIntervalSeconds, color, role,
                aggregate_method AS aggregateMethod
         FROM cps_parameter
         ORDER BY label`,
      )
      .all();
    const links = db
      .prepare("SELECT machine_id AS machineId, parameter_id AS parameterId FROM cps_machine_parameter")
      .all();
    const statesMap = loadStatesMap(db);
    return parameters.map((row) => {
      const id = String(row.id);
      const label = String(row.label);
      const unit = String(row.unit ?? "");
      const states = statesMap.get(id) ?? [];
      return {
        id,
        label,
        unit,
        rangeMin: row.rangeMin == null ? null : Number(row.rangeMin),
        rangeMax: row.rangeMax == null ? null : Number(row.rangeMax),
        sampleIntervalSeconds:
          row.sampleIntervalSeconds == null ? null : Number(row.sampleIntervalSeconds),
        color: row.color == null ? null : String(row.color),
        role: resolveParameterRole(label, id, row.role == null ? null : String(row.role)),
        aggregateMethod: resolveAggregateMethod(
          label,
          id,
          unit,
          row.aggregateMethod == null ? null : String(row.aggregateMethod),
        ),
        states,
        machineIds: links
          .filter((link) => link.parameterId === id)
          .map((link) => String(link.machineId)),
      };
    });
  };

  return {
    kind: "sqlite",
    path: dbPath,
    getState() {
      const count = db.prepare("SELECT COUNT(*) AS count FROM cps_measurement").get();
      return {
        dbPath,
        machines: listMachines(),
        parameters: listParameters(),
        measurementCount: Number(count?.count ?? 0),
      };
    },
    createMachine(input) {
      const id = requireId(input.id, "Идентификаторът");
      const name = requireName(input.name, "Името");
      if (input.kind !== "lathe" && input.kind !== "other") {
        throw new BlondinaInputError("Видът трябва да е струг или друга машина.");
      }
      if (db.prepare("SELECT id FROM cps_machine WHERE id = ?").get(id)) {
        throw new BlondinaInputError("Вече има машина с този идентификатор.");
      }
      db.prepare("INSERT INTO cps_machine (id, name, model, kind) VALUES (?, ?, ?, ?)").run(
        id,
        name,
        text(input.model),
        input.kind,
      );
    },
    updateMachine(input) {
      const id = requireId(input.id, "Идентификаторът");
      const name = requireName(input.name, "Името");
      if (input.kind !== "lathe" && input.kind !== "other") {
        throw new BlondinaInputError("Видът трябва да е струг или друга машина.");
      }
      const result = db
        .prepare("UPDATE cps_machine SET name = ?, model = ?, kind = ? WHERE id = ?")
        .run(name, text(input.model), input.kind, id);
      if (changedRows(result) === 0) throw new BlondinaInputError("Няма такава машина.");
    },
    deleteMachine(id) {
      const result = db.prepare("DELETE FROM cps_machine WHERE id = ?").run(requireId(id, "Идентификаторът"));
      if (changedRows(result) === 0) throw new BlondinaInputError("Няма такава машина.");
    },
    createParameter(input) {
      const id = requireId(input.id, "Идентификаторът");
      const label = requireName(input.label, "Името");
      const prepared = prepareParameterWrite(input);
      if (db.prepare("SELECT id FROM cps_parameter WHERE id = ?").get(id)) {
        throw new BlondinaInputError("Вече има параметър с този идентификатор.");
      }
      const links = machineIds(db, input.machineIds);
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO cps_parameter
             (id, label, unit, range_min, range_max, sample_interval_seconds, color, role, aggregate_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          label,
          text(input.unit) ?? "",
          prepared.rangeMin,
          prepared.rangeMax,
          prepared.sampleIntervalSeconds,
          prepared.color,
          prepared.role,
          prepared.aggregateMethod,
        );
        replaceLinks(db, id, links);
        replaceStates(db, id, prepared.states);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    updateParameter(input) {
      const id = requireId(input.id, "Идентификаторът");
      const label = requireName(input.label, "Името");
      const prepared = prepareParameterWrite(input);
      if (!db.prepare("SELECT id FROM cps_parameter WHERE id = ?").get(id)) {
        throw new BlondinaInputError("Няма такъв параметър.");
      }
      const links = machineIds(db, input.machineIds);
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE cps_parameter
             SET label = ?, unit = ?, range_min = ?, range_max = ?, sample_interval_seconds = ?,
                 color = ?, role = ?, aggregate_method = ?
           WHERE id = ?`,
        ).run(
          label,
          text(input.unit) ?? "",
          prepared.rangeMin,
          prepared.rangeMax,
          prepared.sampleIntervalSeconds,
          prepared.color,
          prepared.role,
          prepared.aggregateMethod,
          id,
        );
        replaceLinks(db, id, links);
        replaceStates(db, id, prepared.states);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    deleteParameter(id) {
      const result = db
        .prepare("DELETE FROM cps_parameter WHERE id = ?")
        .run(requireId(id, "Идентификаторът"));
      if (changedRows(result) === 0) throw new BlondinaInputError("Няма такъв параметър.");
    },
    generate(input, random = Math.random) {
      const fromMs = Date.parse(input.from);
      const toMs = Date.parse(input.to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        throw new BlondinaInputError("Периодът има невалидно време.");
      }
      if (fromMs > toMs) {
        throw new BlondinaInputError("Началото на периода е след края.");
      }
      const series = db
        .prepare(
          `SELECT mp.machine_id AS machineId, mp.parameter_id AS parameterId,
                  p.range_min AS rangeMin, p.range_max AS rangeMax,
                  p.sample_interval_seconds AS sampleIntervalSeconds, p.role AS role
           FROM cps_machine_parameter mp
           JOIN cps_parameter p ON p.id = mp.parameter_id`,
        )
        .all();
      const skipped: GenerateResult["skipped"] = [];
      const runnable: Array<{
        machineId: string;
        parameterId: string;
        rangeMin: number;
        rangeMax: number;
        stepMs: number;
      }> = [];
      for (const row of series) {
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
      const estimated = runnable.reduce((sum, item) => {
        return sum + Math.floor((toMs - fromMs) / item.stepMs) + 1;
      }, 0);
      if (estimated > MAX_GENERATED_ROWS) {
        throw new BlondinaInputError(
          `Периодът дава ${estimated} реда. Скъсете го или увеличете честотата. Таванът е ${MAX_GENERATED_ROWS}.`,
        );
      }
      const insert = db.prepare(
        `INSERT OR REPLACE INTO cps_measurement (machine_id, parameter_id, measured_at, value)
         VALUES (?, ?, ?, ?)`,
      );
      let inserted = 0;
      db.exec("BEGIN");
      try {
        for (const item of runnable) {
          const span = item.rangeMax - item.rangeMin;
          let current = item.rangeMin + random() * span;
          for (let time = fromMs; time <= toMs; time += item.stepMs) {
            current = nextGeneratedValue(current, item.rangeMin, item.rangeMax, random);
            const value = span === 0 ? item.rangeMin : Math.round(current * 1000) / 1000;
            insert.run(item.machineId, item.parameterId, new Date(time).toISOString(), value);
            inserted += 1;
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { inserted, skipped };
    },
    appendDueSamples(now = new Date(), random = Math.random, speedFactor = getSampleSpeedFactor()) {
      const nowMs = now.getTime();
      if (!Number.isFinite(nowMs)) return 0;
      const series = db
        .prepare(
          `SELECT mp.machine_id AS machineId, mp.parameter_id AS parameterId,
                  p.range_min AS rangeMin, p.range_max AS rangeMax,
                  p.sample_interval_seconds AS sampleIntervalSeconds, p.role AS role
           FROM cps_machine_parameter mp
           JOIN cps_parameter p ON p.id = mp.parameter_id
           WHERE p.sample_interval_seconds IS NOT NULL
             AND p.range_min IS NOT NULL AND p.range_max IS NOT NULL
             AND IFNULL(p.role, 'metric') != 'status'`,
        )
        .all();
      const lastSample = db.prepare(
        `SELECT measured_at AS measuredAt, value
         FROM cps_measurement
         WHERE machine_id = ? AND parameter_id = ?
         ORDER BY measured_at DESC
         LIMIT 1`,
      );
      const insert = db.prepare(
        `INSERT OR REPLACE INTO cps_measurement (machine_id, parameter_id, measured_at, value)
         VALUES (?, ?, ?, ?)`,
      );
      let inserted = 0;
      db.exec("BEGIN");
      try {
        for (const row of series) {
          if (parseParameterRole(row.role) === "status") continue;
          const intervalMs = effectiveSampleIntervalMs(Number(row.sampleIntervalSeconds), speedFactor);
          const last = lastSample.get(String(row.machineId), String(row.parameterId));
          const lastMs = last ? Date.parse(String(last.measuredAt)) : Number.NaN;
          if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) continue;
          const rangeMin = Number(row.rangeMin);
          const rangeMax = Number(row.rangeMax);
          const span = rangeMax - rangeMin;
          const previous = last && last.value != null ? Number(last.value) : rangeMin + random() * span;
          const next = nextGeneratedValue(previous, rangeMin, rangeMax, random);
          const value = span === 0 ? rangeMin : Math.round(next * 1000) / 1000;
          insert.run(String(row.machineId), String(row.parameterId), now.toISOString(), value);
          inserted += 1;
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return inserted;
    },
    setMachineStatus(input, now = new Date()) {
      const machineId = requireId(input.machineId, "Идентификаторът на машината");
      const machine = db.prepare("SELECT id FROM cps_machine WHERE id = ?").get(machineId);
      if (!machine) throw new BlondinaInputError(`Няма машина ${machineId}.`);
      const link = db
        .prepare(
          `SELECT p.id AS parameterId, p.label AS label
           FROM cps_machine_parameter mp
           JOIN cps_parameter p ON p.id = mp.parameter_id
           WHERE mp.machine_id = ? AND p.role = 'status'
           ORDER BY p.label
           LIMIT 1`,
        )
        .get(machineId);
      if (!link) {
        throw new BlondinaInputError("На машината няма присвоен статус параметър.");
      }
      const parameterId = String(link.parameterId);
      const states = loadStatesMap(db).get(parameterId) ?? [];
      const value = numberOrNull(input.value);
      if (value == null) throw new BlondinaInputError("Стойността на статуса е задължителна.");
      const state = stateMatching(states, value);
      if (!state) {
        throw new BlondinaInputError("Стойността не е сред дефинираните състояния.");
      }
      const previous = db
        .prepare(
          `SELECT comment FROM cps_status_event
           WHERE machine_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(machineId);
      const comment =
        input.comment === undefined
          ? previous
            ? String(previous.comment ?? "")
            : ""
          : normalizeStatusComment(input.comment);
      const createdAt = now.toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT OR REPLACE INTO cps_measurement (machine_id, parameter_id, measured_at, value)
           VALUES (?, ?, ?, ?)`,
        ).run(machineId, parameterId, createdAt, value);
        db.prepare(
          `INSERT INTO cps_status_event
             (machine_id, parameter_id, status_value, comment, kind, created_at)
           VALUES (?, ?, ?, ?, 'status_change', ?)`,
        ).run(machineId, parameterId, value, comment, createdAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return {
        parameterId,
        value: state.value,
        label: state.label,
        color: state.color,
        comment,
        updatedAt: createdAt,
      };
    },
    setMachineStatusComment(input, now = new Date()) {
      const machineId = requireId(input.machineId, "Идентификаторът на машината");
      const machine = db.prepare("SELECT id FROM cps_machine WHERE id = ?").get(machineId);
      if (!machine) throw new BlondinaInputError(`Няма машина ${machineId}.`);
      const comment = normalizeStatusComment(input.comment);
      const latest = db
        .prepare(
          `SELECT e.parameter_id AS parameterId, e.status_value AS statusValue
           FROM cps_status_event e
           WHERE e.machine_id = ?
           ORDER BY e.created_at DESC, e.id DESC
           LIMIT 1`,
        )
        .get(machineId);
      let parameterId: string;
      let value: number;
      if (latest) {
        parameterId = String(latest.parameterId);
        value = Number(latest.statusValue);
      } else {
        const measurement = db
          .prepare(
            `SELECT m.parameter_id AS parameterId, m.value AS value
             FROM cps_measurement m
             JOIN cps_parameter p ON p.id = m.parameter_id
             WHERE m.machine_id = ? AND p.role = 'status' AND m.value IS NOT NULL
             ORDER BY m.measured_at DESC
             LIMIT 1`,
          )
          .get(machineId);
        if (!measurement) {
          throw new BlondinaInputError("Първо задайте статус, после коментар.");
        }
        parameterId = String(measurement.parameterId);
        value = Number(measurement.value);
      }
      const states = loadStatesMap(db).get(parameterId) ?? [];
      const state = stateMatching(states, value);
      if (!state) {
        throw new BlondinaInputError("Текущият статус не съвпада с дефинираните състояния.");
      }
      const createdAt = now.toISOString();
      db.prepare(
        `INSERT INTO cps_status_event
           (machine_id, parameter_id, status_value, comment, kind, created_at)
         VALUES (?, ?, ?, ?, 'comment_update', ?)`,
      ).run(machineId, parameterId, value, comment, createdAt);
      return {
        parameterId,
        value: state.value,
        label: state.label,
        color: state.color,
        comment,
        updatedAt: createdAt,
      };
    },
    readFirstObject(windowMs) {
      const machine = db
        .prepare("SELECT id, name, model FROM cps_machine ORDER BY rowid LIMIT 1")
        .get();
      if (!machine) return { machine: null, charts: [] };
      const parameters = db
        .prepare(
          `SELECT p.id AS parameterId, p.label AS label, p.unit AS unit,
                  p.range_min AS rangeMin, p.range_max AS rangeMax,
                  p.sample_interval_seconds AS sampleIntervalSeconds
           FROM cps_machine_parameter mp
           JOIN cps_parameter p ON p.id = mp.parameter_id
           WHERE mp.machine_id = ?
           ORDER BY p.rowid
           LIMIT 4`,
        )
        .all(String(machine.id));
      const since = new Date(Date.now() - windowMs).toISOString();
      const points = db.prepare(
        `SELECT measured_at AS timestamp, value
         FROM cps_measurement
         WHERE machine_id = ? AND parameter_id = ? AND measured_at >= ?
         ORDER BY measured_at ASC`,
      );
      return {
        machine: {
          id: String(machine.id),
          name: String(machine.name),
          model: machine.model == null ? null : String(machine.model),
        },
        charts: parameters.map((parameter) => ({
          parameterId: String(parameter.parameterId),
          label: String(parameter.label),
          unit: String(parameter.unit ?? ""),
          writable:
            parameter.rangeMin != null &&
            parameter.rangeMax != null &&
            parameter.sampleIntervalSeconds != null,
          points: points.all(String(machine.id), String(parameter.parameterId), since).map((point) => ({
            timestamp: String(point.timestamp),
            value: point.value == null ? null : Number(point.value),
          })),
        })),
      };
    },
    readDashboard(windowMs) {
      const machines = db.prepare("SELECT id, name, model FROM cps_machine ORDER BY name").all();
      const links = db
        .prepare(
          `SELECT mp.machine_id AS machineId, p.id AS parameterId, p.label AS label,
                  p.unit AS unit, p.range_min AS rangeMin, p.range_max AS rangeMax,
                  p.color AS color, p.role AS role,
                  p.aggregate_method AS aggregateMethod,
                  p.sample_interval_seconds AS sampleIntervalSeconds
           FROM cps_machine_parameter mp
           JOIN cps_parameter p ON p.id = mp.parameter_id
           ORDER BY p.label`,
        )
        .all();
      const statesMap = loadStatesMap(db);
      const since = new Date(Date.now() - windowMs).toISOString();
      const samples = db
        .prepare(
          `SELECT machine_id AS machineId, parameter_id AS parameterId,
                  measured_at AS timestamp, value
           FROM cps_measurement
           WHERE measured_at >= ?
           ORDER BY measured_at ASC`,
        )
        .all(since);
      const latestEvents = db
        .prepare(
          `SELECT e.machine_id AS machineId, e.parameter_id AS parameterId,
                  e.status_value AS statusValue, e.comment AS comment,
                  e.created_at AS createdAt
           FROM cps_status_event e
           INNER JOIN (
             SELECT machine_id, MAX(id) AS maxId
             FROM cps_status_event
             GROUP BY machine_id
           ) latest ON latest.maxId = e.id`,
        )
        .all();
      const latestByMachine = new Map(
        latestEvents.map((row) => [
          String(row.machineId),
          {
            parameterId: String(row.parameterId),
            value: Number(row.statusValue),
            comment: String(row.comment ?? ""),
            updatedAt: String(row.createdAt),
          },
        ]),
      );
      const statusEventRows = db
        .prepare(
          `SELECT e.id AS id, e.machine_id AS machineId, m.name AS machineName,
                  e.parameter_id AS parameterId, p.label AS parameterLabel,
                  e.status_value AS statusValue, e.comment AS comment,
                  e.kind AS kind, e.created_at AS createdAt
           FROM cps_status_event e
           JOIN cps_machine m ON m.id = e.machine_id
           JOIN cps_parameter p ON p.id = e.parameter_id
           WHERE e.created_at >= ?
           ORDER BY e.created_at DESC, e.id DESC`,
        )
        .all(since);
      const statusEvents: StatusEventRow[] = statusEventRows.map((row) => {
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
          createdAt: String(row.createdAt),
        };
      });
      return {
        machines: machines.map((machine) => {
          const machineId = String(machine.id);
          const series = links
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
                role: resolveParameterRole(
                  label,
                  parameterId,
                  link.role == null ? null : String(link.role),
                ),
                aggregateMethod: resolveAggregateMethod(
                  label,
                  parameterId,
                  unit,
                  link.aggregateMethod == null ? null : String(link.aggregateMethod),
                ),
                sampleIntervalSeconds:
                  link.sampleIntervalSeconds == null
                    ? null
                    : Number(link.sampleIntervalSeconds),
                states: statesMap.get(parameterId) ?? [],
                points: samples
                  .filter(
                    (sample) =>
                      sample.machineId === machine.id && sample.parameterId === parameterId,
                  )
                  .map((sample) => ({
                    timestamp: String(sample.timestamp),
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
    clearMeasurements(machineId) {
      const id = machineId?.trim() ?? "";
      if (id) {
        const machine = db.prepare("SELECT id FROM cps_machine WHERE id = ?").get(id);
        if (!machine) throw new BlondinaInputError(`Няма машина ${id}.`);
        const result = db.prepare("DELETE FROM cps_measurement WHERE machine_id = ?").run(id);
        return changedRows(result);
      }
      const result = db.prepare("DELETE FROM cps_measurement").run();
      return changedRows(result);
    },
    listMeasurements(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 40, 1), 200);
      const rows = filter.machineId
        ? db
            .prepare(
              `SELECT m.id AS machineId, m.name AS machineName,
                      p.id AS parameterId, p.label AS parameterLabel, p.unit AS unit,
                      s.measured_at AS measuredAt, s.value AS value
               FROM cps_measurement s
               JOIN cps_machine m ON m.id = s.machine_id
               JOIN cps_parameter p ON p.id = s.parameter_id
               WHERE s.machine_id = ?
               ORDER BY s.measured_at DESC
               LIMIT ?`,
            )
            .all(filter.machineId, limit)
        : db
            .prepare(
              `SELECT m.id AS machineId, m.name AS machineName,
                      p.id AS parameterId, p.label AS parameterLabel, p.unit AS unit,
                      s.measured_at AS measuredAt, s.value AS value
               FROM cps_measurement s
               JOIN cps_machine m ON m.id = s.machine_id
               JOIN cps_parameter p ON p.id = s.parameter_id
               ORDER BY s.measured_at DESC
               LIMIT ?`,
            )
            .all(limit);
      return rows.map((row) => ({
        machineId: String(row.machineId),
        machineName: String(row.machineName),
        parameterId: String(row.parameterId),
        parameterLabel: String(row.parameterLabel),
        unit: String(row.unit ?? ""),
        measuredAt: String(row.measuredAt),
        value: row.value == null ? null : Number(row.value),
      }));
    },
    close() {
      db.close();
    },
  };
}
