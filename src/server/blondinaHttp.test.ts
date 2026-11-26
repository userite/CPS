import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { openBlondina } from "./blondina";
import { handleBlondinaRequest } from "./blondinaHttp";

function mockReq(method: string, path: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from([payload]) as IncomingMessage;
  stream.method = method;
  stream.url = path;
  stream.headers = body === undefined ? {} : { "content-type": "application/json" };
  return stream;
}

function mockRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 200,
    body: "",
    setHeader() {
      return res;
    },
    end(chunk?: unknown) {
      res.body = chunk == null ? "" : String(chunk);
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

describe("blondinaHttp parameters", () => {
  it("keeps aggregateMethod when editing a parameter via PUT", async () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    expect(spindle.aggregateMethod).toBe("avg");

    const res = mockRes();
    const handled = await handleBlondinaRequest(
      db,
      mockReq("PUT", "/api/cps/parameters", {
        id: spindle.id,
        label: spindle.label,
        unit: spindle.unit,
        rangeMin: spindle.rangeMin,
        rangeMax: spindle.rangeMax,
        sampleIntervalSeconds: spindle.sampleIntervalSeconds,
        color: spindle.color,
        role: spindle.role,
        aggregateMethod: "min",
        states: spindle.states,
        machineIds: spindle.machineIds,
      }),
      res,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const state = JSON.parse(res.body) as {
      parameters: Array<{ id: string; aggregateMethod: string }>;
    };
    expect(state.parameters.find((parameter) => parameter.id === "spindle_speed")?.aggregateMethod).toBe(
      "min",
    );
    expect(db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")?.aggregateMethod).toBe(
      "min",
    );
    db.close();
  });

  it("allows aggregateMethod=last for plan and report roles", async () => {
    const db = openBlondina(":memory:");
    for (const role of ["plan", "report"] as const) {
      const create = mockRes();
      expect(
        await handleBlondinaRequest(
          db,
          mockReq("POST", "/api/cps/parameters", {
            id: `${role}_qty`,
            label: role === "plan" ? "План" : "Отчет",
            unit: "бр",
            rangeMin: 0,
            rangeMax: 100,
            sampleIntervalSeconds: 60,
            role,
            aggregateMethod: "last",
            machineIds: ["LATHE_01"],
          }),
          create,
        ),
      ).toBe(true);
      expect(create.statusCode).toBe(200);

      const update = mockRes();
      expect(
        await handleBlondinaRequest(
          db,
          mockReq("PUT", "/api/cps/parameters", {
            id: `${role}_qty`,
            label: role === "plan" ? "План" : "Отчет",
            unit: "бр",
            rangeMin: 0,
            rangeMax: 100,
            sampleIntervalSeconds: 60,
            role,
            aggregateMethod: "last",
            machineIds: ["LATHE_01"],
          }),
          update,
        ),
      ).toBe(true);
      expect(update.statusCode).toBe(200);
      const state = JSON.parse(update.body) as {
        parameters: Array<{ id: string; role: string; aggregateMethod: string }>;
      };
      const row = state.parameters.find((parameter) => parameter.id === `${role}_qty`);
      expect(row?.role).toBe(role);
      expect(row?.aggregateMethod).toBe("last");
    }
    db.close();
  });

  it("sets machine status and later comment via API", async () => {
    const db = openBlondina(":memory:");
    db.createParameter({
      id: "machine_status",
      label: "Състояние",
      role: "status",
      states: [
        { value: 0, label: "работи", color: "#3ddc97" },
        { value: 1, label: "авария", color: "#e53935" },
      ],
      machineIds: ["LATHE_01"],
    });

    const statusRes = mockRes();
    expect(
      await handleBlondinaRequest(
        db,
        mockReq("PUT", "/api/cps/machine-status", {
          machineId: "LATHE_01",
          value: 1,
        }),
        statusRes,
      ),
    ).toBe(true);
    expect(statusRes.statusCode).toBe(200);
    expect(JSON.parse(statusRes.body).label).toBe("авария");

    const commentRes = mockRes();
    expect(
      await handleBlondinaRequest(
        db,
        mockReq("PUT", "/api/cps/machine-status/comment", {
          machineId: "LATHE_01",
          comment: "прогнозно 45 мин",
        }),
        commentRes,
      ),
    ).toBe(true);
    expect(commentRes.statusCode).toBe(200);
    expect(JSON.parse(commentRes.body).comment).toBe("прогнозно 45 мин");

    const dash = mockRes();
    expect(await handleBlondinaRequest(db, mockReq("GET", "/api/cps/dashboard?minutes=60"), dash)).toBe(
      true,
    );
    const reading = JSON.parse(dash.body) as {
      statusEvents: Array<{ kind: string; comment: string }>;
      machines: Array<{ id: string; manualStatus: { comment: string; label: string } | null }>;
    };
    expect(reading.machines.find((m) => m.id === "LATHE_01")?.manualStatus?.comment).toBe(
      "прогнозно 45 мин",
    );
    expect(reading.statusEvents.some((e) => e.kind === "comment_update" && e.comment === "прогнозно 45 мин")).toBe(
      true,
    );
    db.close();
  });
});
