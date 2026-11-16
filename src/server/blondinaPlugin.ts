import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { AsyncBlondina } from "./blondina";
import { handleBlondinaRequest } from "./blondinaHttp";
import { loadBlondinaSqlConfig, openBlondinaSql } from "./blondinaSql";

const globalStore = globalThis as typeof globalThis & {
  __cpsBlondina?: AsyncBlondina;
  __cpsWriter?: ReturnType<typeof setInterval>;
  __cpsOpening?: Promise<AsyncBlondina>;
};

const writerTickMs = 1_000;

function ensureWriter(db: AsyncBlondina): void {
  if (globalStore.__cpsWriter) return;
  let writing = false;
  globalStore.__cpsWriter = setInterval(() => {
    if (writing) return;
    writing = true;
    void Promise.resolve(db.appendDueSamples(new Date()))
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        writing = false;
      });
  }, writerTickMs);
}

function database(): Promise<AsyncBlondina> {
  const current = globalStore.__cpsBlondina;
  if (current?.kind === "sqlserver") {
    ensureWriter(current);
    return Promise.resolve(current);
  }
  if (!globalStore.__cpsOpening) {
    if (current) {
      void Promise.resolve(current.close());
      globalStore.__cpsBlondina = undefined;
    }
    if (globalStore.__cpsWriter) {
      clearInterval(globalStore.__cpsWriter);
      globalStore.__cpsWriter = undefined;
    }
    globalStore.__cpsOpening = openBlondinaSql(loadBlondinaSqlConfig())
      .then((db) => {
        globalStore.__cpsBlondina = db;
        ensureWriter(db);
        console.log(`CPS база: ${db.path}`);
        return db;
      })
      .catch((error: unknown) => {
        globalStore.__cpsOpening = undefined;
        throw error;
      });
  }
  return globalStore.__cpsOpening;
}

export function blondinaPlugin(): Plugin {
  return {
    name: "cps-blondina",
    configureServer(server) {
      if (!process.env.VITEST) {
        void database().catch((error: unknown) => {
          console.error(error);
        });
      }
      server.middlewares.use((req, res, next) => {
        const request = req as IncomingMessage;
        const response = res as ServerResponse;
        void database()
          .then((db) => handleBlondinaRequest(db, request, response))
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            if (response.headersSent) return;
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Грешка в базата.",
              }),
            );
          });
      });
    },
  };
}
