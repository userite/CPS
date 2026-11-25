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
});
