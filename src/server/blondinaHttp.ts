import type { IncomingMessage, ServerResponse } from "node:http";
import { BlondinaInputError, type AsyncBlondina, type MachineInput, type ParameterInput } from "./blondina";
import { getSampleSpeedFactor, setSampleSpeedFactor } from "./sampleSpeedFactor";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function asMachine(body: unknown): MachineInput {
  const record = body as Partial<MachineInput>;
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    model: record.model,
    kind: record.kind === "lathe" ? "lathe" : "other",
  };
}

function asParameter(body: unknown): ParameterInput {
  const record = body as Partial<ParameterInput>;
  return {
    id: String(record.id ?? ""),
    label: String(record.label ?? ""),
    unit: record.unit,
    rangeMin: record.rangeMin,
    rangeMax: record.rangeMax,
    sampleIntervalSeconds: record.sampleIntervalSeconds,
    color: record.color,
    role: record.role,
    aggregateMethod: record.aggregateMethod,
    states: Array.isArray(record.states) ? record.states : [],
    machineIds: Array.isArray(record.machineIds) ? record.machineIds.map(String) : [],
  };
}

export async function handleBlondinaRequest(
  db: AsyncBlondina,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/cps")) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/cps/state") {
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/cps/dashboard") {
      const minutes = Number(url.searchParams.get("minutes") ?? 60);
      const windowMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
      send(res, 200, await db.readDashboard(windowMs));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/cps/object") {
      const minutes = Number(url.searchParams.get("minutes") ?? 60);
      const windowMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
      send(res, 200, await db.readFirstObject(windowMs));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/cps/measurements") {
      send(res, 200, await db.listMeasurements({
        machineId: url.searchParams.get("machineId") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 40),
      }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/cps/machines") {
      await db.createMachine(asMachine(await readJson(req)));
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "PUT" && url.pathname === "/api/cps/machines") {
      await db.updateMachine(asMachine(await readJson(req)));
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "DELETE" && url.pathname === "/api/cps/machines") {
      await db.deleteMachine(url.searchParams.get("id") ?? "");
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/cps/parameters") {
      await db.createParameter(asParameter(await readJson(req)));
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "PUT" && url.pathname === "/api/cps/parameters") {
      await db.updateParameter(asParameter(await readJson(req)));
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "DELETE" && url.pathname === "/api/cps/parameters") {
      await db.deleteParameter(url.searchParams.get("id") ?? "");
      send(res, 200, await db.getState());
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/cps/generate") {
      const body = (await readJson(req)) as { from?: string; to?: string };
      send(res, 200, await db.generate({ from: String(body.from ?? ""), to: String(body.to ?? "") }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/cps/speed-factor") {
      send(res, 200, { factor: getSampleSpeedFactor() });
      return true;
    }
    if (
      (req.method === "PUT" || req.method === "POST") &&
      url.pathname === "/api/cps/speed-factor"
    ) {
      const body = (await readJson(req)) as { factor?: unknown };
      send(res, 200, { factor: setSampleSpeedFactor(body.factor) });
      return true;
    }
    if (req.method === "DELETE" && url.pathname === "/api/cps/measurements") {
      const machineId = url.searchParams.get("machineId")?.trim() || undefined;
      send(res, 200, { deleted: await db.clearMeasurements(machineId) });
      return true;
    }
    if (req.method === "PUT" && url.pathname === "/api/cps/machine-status") {
      const body = (await readJson(req)) as {
        machineId?: unknown;
        value?: unknown;
        comment?: unknown;
      };
      send(
        res,
        200,
        await db.setMachineStatus({
          machineId: String(body.machineId ?? ""),
          value: Number(body.value),
          comment: body.comment === undefined ? undefined : body.comment == null ? "" : String(body.comment),
        }),
      );
      return true;
    }
    if (req.method === "PUT" && url.pathname === "/api/cps/machine-status/comment") {
      const body = (await readJson(req)) as { machineId?: unknown; comment?: unknown };
      send(
        res,
        200,
        await db.setMachineStatusComment({
          machineId: String(body.machineId ?? ""),
          comment: body.comment == null ? "" : String(body.comment),
        }),
      );
      return true;
    }
    send(res, 404, { error: "Няма такъв адрес." });
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(res, 400, { error: "Заявката не е валиден JSON." });
      return true;
    }
    if (error instanceof BlondinaInputError) {
      send(res, 400, { error: error.message });
      return true;
    }
    send(res, 500, { error: error instanceof Error ? error.message : "Грешка в базата." });
    return true;
  }
}
