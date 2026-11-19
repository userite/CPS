import { chartWindowMinutes } from "../src/config/dashboard.ts";
import { buildPlanProgress, parameterPlanRole } from "../src/domain/planProgress.ts";
import { loadBlondinaSqlConfig, openBlondinaSql } from "../src/server/blondinaSql.ts";

const db = await openBlondinaSql(loadBlondinaSqlConfig());
const state = await db.getState();
console.log("DB", db.path);
console.log("PARAMETERS");
for (const parameter of state.parameters) {
  const role = parameterPlanRole(parameter.label);
  const codes = [...parameter.label].map((char) => `${char}:${char.codePointAt(0)?.toString(16)}`);
  console.log(
    JSON.stringify({
      id: parameter.id,
      label: parameter.label,
      role,
      machines: parameter.machineIds,
      rangeMin: parameter.rangeMin,
      rangeMax: parameter.rangeMax,
      interval: parameter.sampleIntervalSeconds,
      codes,
    }),
  );
}

const dash = await db.readDashboard(chartWindowMinutes * 60_000);
for (const machine of dash.machines) {
  const progress = buildPlanProgress(
    machine.series,
    machine.series.map((series) => series.parameterId),
  );
  console.log(
    "MACHINE",
    JSON.stringify({
      id: machine.id,
      name: machine.name,
      series: machine.series.length,
      progress,
      roles: machine.series.map((series) => ({
        id: series.parameterId,
        label: series.label,
        role: parameterPlanRole(series.label),
        finitePoints: series.points.filter((point) => point.value != null).length,
        last: series.points.filter((point) => point.value != null).at(-1) ?? null,
      })),
    }),
  );
}
await db.close();
