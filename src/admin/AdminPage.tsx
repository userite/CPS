import { useEffect, useState } from "react";
import {
  AGGREGATE_METHODS,
  AGGREGATE_METHOD_LABELS,
  defaultAggregateMethod,
  type AggregateMethod,
} from "../domain/aggregateMethod";
import { DEFAULT_STATUS_STATES, type ParameterRole } from "../domain/parameterRole";
import type {
  BlondinaState,
  GenerateResult,
  MachineKind,
  MachineRow,
  MeasurementRow,
  ParameterRow,
} from "../server/blondina";
import "./Admin.css";

type Tab = "machines" | "parameters" | "generator";

type MachineDraft = {
  id: string;
  name: string;
  model: string;
  kind: MachineKind;
};

type StateDraft = {
  value: string;
  label: string;
  color: string;
};

type ParameterDraft = {
  id: string;
  label: string;
  unit: string;
  rangeMin: string;
  rangeMax: string;
  sampleIntervalSeconds: string;
  color: string;
  role: ParameterRole;
  aggregateMethod: AggregateMethod;
  states: StateDraft[];
  machineIds: string[];
};

const emptyMachine: MachineDraft = { id: "", name: "", model: "", kind: "lathe" };
const emptyParameter: ParameterDraft = {
  id: "",
  label: "",
  unit: "",
  rangeMin: "",
  rangeMax: "",
  sampleIntervalSeconds: "",
  color: "",
  role: "metric",
  aggregateMethod: "avg",
  states: DEFAULT_STATUS_STATES.map((state) => ({
    value: String(state.value),
    label: state.label,
    color: state.color,
  })),
  machineIds: [],
};

const ROLE_LABELS: Record<ParameterRole, string> = {
  metric: "Линейна графика",
  plan: "План",
  report: "Отчет / изпълнение",
  status: "Статус (лента)",
};

function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Заявката не мина.");
  return body;
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("parameters");
  const [state, setState] = useState<BlondinaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [machineDraft, setMachineDraft] = useState<MachineDraft>(emptyMachine);
  const [editingMachine, setEditingMachine] = useState(false);
  const [parameterDraft, setParameterDraft] = useState<ParameterDraft>(emptyParameter);
  const [editingParameter, setEditingParameter] = useState(false);
  const [from, setFrom] = useState(() => localInputValue(new Date(Date.now() - 60 * 60_000)));
  const [to, setTo] = useState(() => localInputValue(new Date()));
  const [report, setReport] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [measurementMachine, setMeasurementMachine] = useState("");

  async function reload(machineId = measurementMachine): Promise<void> {
    const next = await request<BlondinaState>("/api/cps/state");
    setState(next);
    const rows = await request<MeasurementRow[]>(
      `/api/cps/measurements?limit=30${machineId ? `&machineId=${encodeURIComponent(machineId)}` : ""}`,
    );
    setMeasurements(rows);
  }

  useEffect(() => {
    void reload().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Базата не отговаря.");
    });
    // The first load has no saved filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Заявката не мина.");
    }
  }

  function editMachine(machine: MachineRow): void {
    setEditingMachine(true);
    setMachineDraft({
      id: machine.id,
      name: machine.name,
      model: machine.model ?? "",
      kind: machine.kind,
    });
    setTab("machines");
  }

  function editParameter(parameter: ParameterRow): void {
    setEditingParameter(true);
    setParameterDraft({
      id: parameter.id,
      label: parameter.label,
      unit: parameter.unit,
      rangeMin: parameter.rangeMin == null ? "" : String(parameter.rangeMin),
      rangeMax: parameter.rangeMax == null ? "" : String(parameter.rangeMax),
      sampleIntervalSeconds:
        parameter.sampleIntervalSeconds == null ? "" : String(parameter.sampleIntervalSeconds),
      color: parameter.color ?? "",
      role: parameter.role,
      aggregateMethod: parameter.aggregateMethod,
      states:
        parameter.states.length > 0
          ? parameter.states.map((state) => ({
              value: String(state.value),
              label: state.label,
              color: state.color,
            }))
          : emptyParameter.states,
      machineIds: parameter.machineIds,
    });
    setTab("parameters");
  }

  const machineName = new Map(state?.machines.map((machine) => [machine.id, machine.name]));

  return (
    <main className="dash admin">
      <header className="dash-header">
        <div>
          <p className="kicker">blondina</p>
          <h1>Администрация</h1>
        </div>
      </header>
      <p className="demo-note">
        Базата е SQL Server <span className="admin-path">{state?.dbPath ?? "CPS_ATRA"}</span>.
        Таблиците са <span className="admin-path">cps_machine</span>, <span className="admin-path">cps_parameter</span>,{" "}
        <span className="admin-path">cps_parameter_state</span>, <span className="admin-path">cps_machine_parameter</span> и{" "}
        <span className="admin-path">cps_measurement</span>.
        Ролята казва дали параметърът е за линейна графика, план/отчет или статусна лента на таблото.
        Полето <span className="admin-path">aggregate_method</span> задава как се комбинира стойността
        през всички машини в долната обща графика (sum / avg / last / min / max / count).
        Ако не е зададено: sum за бройни параметри, иначе avg.
      </p>
      {error && <p className="admin-error">{error}</p>}
      <div className="admin-tabs" role="tablist">
        <button type="button" aria-pressed={tab === "machines"} onClick={() => setTab("machines")}>Машини</button>
        <button type="button" aria-pressed={tab === "parameters"} onClick={() => setTab("parameters")}>Параметри</button>
        <button type="button" aria-pressed={tab === "generator"} onClick={() => setTab("generator")}>Генератор</button>
      </div>

      {tab === "machines" && (
        <section className="admin-grid">
          <form
            className="admin-card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await request(editingMachine ? "/api/cps/machines" : "/api/cps/machines", {
                  method: editingMachine ? "PUT" : "POST",
                  body: JSON.stringify({
                    ...machineDraft,
                    model: machineDraft.model.trim() || null,
                  }),
                });
                setMachineDraft(emptyMachine);
                setEditingMachine(false);
                await reload();
              });
            }}
          >
            <h2>{editingMachine ? "Редакция на машина" : "Нова машина"}</h2>
            <label>
              Идентификатор
              <input
                value={machineDraft.id}
                disabled={editingMachine}
                onChange={(event) => setMachineDraft({ ...machineDraft, id: event.target.value })}
                required
              />
            </label>
            <label>
              Име
              <input
                value={machineDraft.name}
                onChange={(event) => setMachineDraft({ ...machineDraft, name: event.target.value })}
                required
              />
            </label>
            <label>
              Модел
              <input
                value={machineDraft.model}
                onChange={(event) => setMachineDraft({ ...machineDraft, model: event.target.value })}
              />
            </label>
            <label>
              Вид
              <select
                value={machineDraft.kind}
                onChange={(event) =>
                  setMachineDraft({ ...machineDraft, kind: event.target.value as MachineKind })
                }
              >
                <option value="lathe">Струг</option>
                <option value="other">Друга машина</option>
              </select>
            </label>
            <div className="admin-actions">
              <button type="submit" className="btn">{editingMachine ? "Запиши" : "Добави"}</button>
              {editingMachine && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditingMachine(false);
                    setMachineDraft(emptyMachine);
                  }}
                >
                  Отказ
                </button>
              )}
            </div>
          </form>
          <div className="admin-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Машина</th>
                  <th>Вид</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state?.machines.map((machine) => (
                  <tr key={machine.id}>
                    <td>
                      <strong>{machine.name}</strong>
                      <div className="admin-muted">{machine.id}{machine.model ? ` · ${machine.model}` : ""}</div>
                    </td>
                    <td>{machine.kind === "lathe" ? "Струг" : "Друга"}</td>
                    <td className="admin-actions">
                      <button type="button" className="btn" onClick={() => editMachine(machine)}>Редакция</button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          if (!window.confirm(`Да се изтрие ли ${machine.name}? Измерванията ѝ също се трият.`)) return;
                          void run(async () => {
                            await request(`/api/cps/machines?id=${encodeURIComponent(machine.id)}`, { method: "DELETE" });
                            await reload();
                          });
                        }}
                      >
                        Изтрий
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "parameters" && (
        <section className="admin-grid">
          <form
            className="admin-card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await request("/api/cps/parameters", {
                  method: editingParameter ? "PUT" : "POST",
                  body: JSON.stringify({
                    id: parameterDraft.id,
                    label: parameterDraft.label,
                    unit: parameterDraft.unit,
                    rangeMin: optionalNumber(parameterDraft.rangeMin),
                    rangeMax: optionalNumber(parameterDraft.rangeMax),
                    sampleIntervalSeconds: optionalNumber(parameterDraft.sampleIntervalSeconds),
                    color: parameterDraft.color,
                    role: parameterDraft.role,
                    aggregateMethod:
                      parameterDraft.role === "status" ? null : parameterDraft.aggregateMethod,
                    states:
                      parameterDraft.role === "status"
                        ? parameterDraft.states.map((state) => ({
                            value: optionalNumber(state.value),
                            label: state.label,
                            color: state.color,
                          }))
                        : [],
                    machineIds: parameterDraft.machineIds,
                  }),
                });
                setParameterDraft(emptyParameter);
                setEditingParameter(false);
                await reload();
              });
            }}
          >
            <h2>{editingParameter ? "Редакция на параметър" : "Нов параметър"}</h2>
            <label>
              Идентификатор
              <input
                value={parameterDraft.id}
                disabled={editingParameter}
                onChange={(event) => setParameterDraft({ ...parameterDraft, id: event.target.value })}
                required
              />
            </label>
            <label>
              Име
              <input
                value={parameterDraft.label}
                onChange={(event) => setParameterDraft({ ...parameterDraft, label: event.target.value })}
                required
              />
            </label>
            <label>
              Роля
              <select
                value={parameterDraft.role}
                onChange={(event) =>
                  setParameterDraft({
                    ...parameterDraft,
                    role: event.target.value as ParameterRole,
                  })
                }
              >
                {(Object.keys(ROLE_LABELS) as ParameterRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <p className="admin-muted">
              План и отчет захранват кръга на таблото. Статусът е отделна лента от квадратчета и не влиза в линейната графика.
            </p>
            {parameterDraft.role !== "status" ? (
              <>
                <label>
                  Агрегиране през машини
                  <select
                    value={parameterDraft.aggregateMethod}
                    onChange={(event) =>
                      setParameterDraft({
                        ...parameterDraft,
                        aggregateMethod: event.target.value as AggregateMethod,
                      })
                    }
                    aria-label="Метод за агрегиране през машини"
                  >
                    {AGGREGATE_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {AGGREGATE_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="admin-muted">
                  Поле <span className="admin-path">aggregate_method</span> за долната обща графика на
                  таблото. Важи за линейна, план и отчет (вкл. last). Ако в базата е празно: sum за
                  бройни (count / брой / детайли), иначе avg.{" "}
                  Предложение според името:{" "}
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setParameterDraft({
                        ...parameterDraft,
                        aggregateMethod: defaultAggregateMethod(
                          parameterDraft.label || parameterDraft.id,
                          parameterDraft.id,
                          parameterDraft.unit,
                        ),
                      })
                    }
                  >
                    {
                      AGGREGATE_METHOD_LABELS[
                        defaultAggregateMethod(
                          parameterDraft.label || parameterDraft.id,
                          parameterDraft.id,
                          parameterDraft.unit,
                        )
                      ]
                    }
                  </button>
                  . Методи: sum, avg, last (най-късен sample в кофата), min, max, count (брой машини с
                  валидна стойност). На таблото отчетът винаги се комбинира като sum след последния
                  план; планът ползва избрания метод.
                </p>
                <label>
                  Единица
                  <input
                    value={parameterDraft.unit}
                    onChange={(event) => setParameterDraft({ ...parameterDraft, unit: event.target.value })}
                  />
                </label>
                <div className="admin-pair">
                  <label>
                    От
                    <input
                      inputMode="decimal"
                      value={parameterDraft.rangeMin}
                      onChange={(event) => setParameterDraft({ ...parameterDraft, rangeMin: event.target.value })}
                    />
                  </label>
                  <label>
                    До
                    <input
                      inputMode="decimal"
                      value={parameterDraft.rangeMax}
                      onChange={(event) => setParameterDraft({ ...parameterDraft, rangeMax: event.target.value })}
                    />
                  </label>
                </div>
                {parameterDraft.role === "metric" ? (
                  <>
                    <label>
                      Цвят
                      <input
                        value={parameterDraft.color}
                        placeholder="#929292"
                        maxLength={7}
                        spellCheck={false}
                        onChange={(event) => setParameterDraft({ ...parameterDraft, color: event.target.value })}
                      />
                    </label>
                    <p className="admin-muted">Празно поле оставя автоматичния цвят. Форматът е #929292.</p>
                  </>
                ) : null}
              </>
            ) : (
              <fieldset>
                <legend>Състояния</legend>
                <p className="admin-muted">
                  Стойност · текст · цвят. Пример: 0 работи зелено, 1 авария червено, 2 технологичен престой жълто.
                  Статусът се задава ръчно от таблото (не се генерира). Коментар към авария се пише после на таблото.
                </p>
                {parameterDraft.states.map((state, index) => (
                  <div key={index} className="admin-state-row">
                    <input
                      inputMode="decimal"
                      value={state.value}
                      aria-label={`Стойност ${index + 1}`}
                      onChange={(event) => {
                        const states = [...parameterDraft.states];
                        states[index] = { ...state, value: event.target.value };
                        setParameterDraft({ ...parameterDraft, states });
                      }}
                    />
                    <input
                      value={state.label}
                      aria-label={`Текст ${index + 1}`}
                      onChange={(event) => {
                        const states = [...parameterDraft.states];
                        states[index] = { ...state, label: event.target.value };
                        setParameterDraft({ ...parameterDraft, states });
                      }}
                    />
                    <input
                      value={state.color}
                      maxLength={7}
                      spellCheck={false}
                      aria-label={`Цвят ${index + 1}`}
                      onChange={(event) => {
                        const states = [...parameterDraft.states];
                        states[index] = { ...state, color: event.target.value };
                        setParameterDraft({ ...parameterDraft, states });
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setParameterDraft({
                          ...parameterDraft,
                          states: parameterDraft.states.filter((_, row) => row !== index),
                        })
                      }
                    >
                      –
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setParameterDraft({
                      ...parameterDraft,
                      states: [...parameterDraft.states, { value: "", label: "", color: "#929292" }],
                    })
                  }
                >
                  Добави състояние
                </button>
              </fieldset>
            )}
            <label>
              Честота, секунди
              <input
                inputMode="numeric"
                value={parameterDraft.sampleIntervalSeconds}
                onChange={(event) =>
                  setParameterDraft({ ...parameterDraft, sampleIntervalSeconds: event.target.value })
                }
              />
            </label>
            {parameterDraft.role === "status" ? (
              <p className="admin-muted">
                За статус честотата не се ползва — стойностите се пишат ръчно от таблото.
              </p>
            ) : null}
            <fieldset>
              <legend>Машини</legend>
              {state?.machines.map((machine) => (
                <label key={machine.id} className="admin-check">
                  <input
                    type="checkbox"
                    checked={parameterDraft.machineIds.includes(machine.id)}
                    onChange={(event) => {
                      const machineIds = event.target.checked
                        ? [...parameterDraft.machineIds, machine.id]
                        : parameterDraft.machineIds.filter((id) => id !== machine.id);
                      setParameterDraft({ ...parameterDraft, machineIds });
                    }}
                  />
                  {machine.name}
                </label>
              ))}
            </fieldset>
            <div className="admin-actions">
              <button type="submit" className="btn">{editingParameter ? "Запиши" : "Добави"}</button>
              {editingParameter && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditingParameter(false);
                    setParameterDraft(emptyParameter);
                  }}
                >
                  Отказ
                </button>
              )}
            </div>
          </form>
          <div className="admin-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Параметър</th>
                  <th>Роля</th>
                  <th>Агрегиране</th>
                  <th>Диапазон / състояния</th>
                  <th>Честота</th>
                  <th>Машини</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state?.parameters.map((parameter) => (
                  <tr key={parameter.id}>
                    <td>
                      <strong>{parameter.label}</strong>
                      <div className="admin-muted">
                        {parameter.color && (
                          <i className="admin-swatch" style={{ background: parameter.color }} aria-hidden="true" />
                        )}
                        {parameter.id}
                        {parameter.unit ? ` · ${parameter.unit}` : ""}
                        {parameter.color ? ` · ${parameter.color}` : ""}
                      </div>
                    </td>
                    <td>{ROLE_LABELS[parameter.role]}</td>
                    <td>
                      {parameter.role === "status"
                        ? "—"
                        : AGGREGATE_METHOD_LABELS[parameter.aggregateMethod]}
                    </td>
                    <td>
                      {parameter.role === "status"
                        ? parameter.states
                            .map((state) => `${state.value}=${state.label}`)
                            .join(", ") || "няма състояния"
                        : parameter.rangeMin == null || parameter.rangeMax == null
                          ? "не е зададен"
                          : `${parameter.rangeMin} – ${parameter.rangeMax}`}
                    </td>
                    <td>{parameter.sampleIntervalSeconds == null ? "—" : `${parameter.sampleIntervalSeconds} сек`}</td>
                    <td>{parameter.machineIds.map((id) => machineName.get(id) ?? id).join(", ")}</td>
                    <td className="admin-actions">
                      <button type="button" className="btn" onClick={() => editParameter(parameter)}>Редакция</button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          if (!window.confirm(`Да се изтрие ли ${parameter.label}?`)) return;
                          void run(async () => {
                            await request(`/api/cps/parameters?id=${encodeURIComponent(parameter.id)}`, {
                              method: "DELETE",
                            });
                            await reload();
                          });
                        }}
                      >
                        Изтрий
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "generator" && (
        <section className="admin-stack">
          <form
            className="admin-card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await request<GenerateResult>("/api/cps/generate", {
                  method: "POST",
                  body: JSON.stringify({
                    from: new Date(from).toISOString(),
                    to: new Date(to).toISOString(),
                  }),
                });
                const skippedParameters = new Set(result.skipped.map((item) => item.parameterId)).size;
                setReport(
                  result.inserted === 0
                    ? "Няма записани редове. Попълнете диапазон и честота на параметрите, които искате да генерирате."
                    : `Записани ${result.inserted} измервания. Пропуснати серии: ${result.skipped.length}, от ${skippedParameters} параметъра без диапазон или честота.`,
                );
                await reload();
              });
            }}
          >
            <h2>Генератор на измервания</h2>
            <p className="admin-muted">
              За всяка машина и параметър с диапазон и честота се записват стойности около диапазона.
              Повечето проби остават в границите; рядко (около 8%) могат да излязат до 20% извън тях за тест.
              Няма производствена формула. Липсващ диапазон не се заменя с нула.
            </p>
            <div className="admin-pair">
              <label>
                От
                <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} required />
              </label>
              <label>
                До
                <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} required />
              </label>
            </div>
            <div className="admin-actions">
              <button type="submit" className="btn">Генерирай</button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (!window.confirm("Да се изтрият ли всички измервания?")) return;
                  void run(async () => {
                    await request("/api/cps/measurements", { method: "DELETE" });
                    setReport("Всички измервания са изчистени.");
                    await reload();
                  });
                }}
              >
                Изчисти всички измервания
              </button>
            </div>
            {report && <p>{report}</p>}
            <p className="admin-muted">Записи в базата: {state?.measurementCount ?? 0}</p>
          </form>
          <div className="admin-card">
            <div className="admin-toolbar">
              <h2>Последни измервания</h2>
              <label>
                Машина
                <select
                  value={measurementMachine}
                  onChange={(event) => {
                    const machineId = event.target.value;
                    setMeasurementMachine(machineId);
                    void run(() => reload(machineId));
                  }}
                >
                  <option value="">Всички</option>
                  {state?.machines.map((machine) => (
                    <option key={machine.id} value={machine.id}>{machine.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={!measurementMachine}
                title={
                  measurementMachine
                    ? "Изтрива само измерванията на избраната машина"
                    : "Изберете машина от списъка"
                }
                onClick={() => {
                  if (!measurementMachine) return;
                  const machineName =
                    state?.machines.find((machine) => machine.id === measurementMachine)?.name ??
                    measurementMachine;
                  if (!window.confirm(`Да се изтрият ли измерванията само за „${machineName}“?`)) {
                    return;
                  }
                  void run(async () => {
                    const result = await request<{ deleted: number }>(
                      `/api/cps/measurements?machineId=${encodeURIComponent(measurementMachine)}`,
                      { method: "DELETE" },
                    );
                    setReport(
                      `Изчистени ${result.deleted} измервания за „${machineName}“.`,
                    );
                    await reload(measurementMachine);
                  });
                }}
              >
                Изчисти данните на машината
              </button>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Време</th>
                  <th>Машина</th>
                  <th>Параметър</th>
                  <th>Стойност</th>
                </tr>
              </thead>
              <tbody>
                {measurements.length === 0 && (
                  <tr>
                    <td colSpan={4} className="admin-muted">Няма измервания.</td>
                  </tr>
                )}
                {measurements.map((row) => (
                  <tr key={`${row.machineId}-${row.parameterId}-${row.measuredAt}`}>
                    <td>{new Date(row.measuredAt).toLocaleString("bg-BG")}</td>
                    <td>{row.machineName}</td>
                    <td>{row.parameterLabel}</td>
                    <td>{row.value == null ? "—" : `${row.value} ${row.unit}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
