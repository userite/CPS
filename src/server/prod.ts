import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { AsyncBlondina } from "./blondina";
import { handleBlondinaRequest } from "./blondinaHttp";
import { loadBlondinaSqlConfig, openBlondinaSql } from "./blondinaSql";

const port = Number(process.env.PORT || 3000);
const root = resolve(process.cwd(), "dist");

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function insideRoot(filePath: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return filePath === root || filePath.startsWith(rootWithSep);
}

function sendFile(res: ServerResponse, filePath: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", mime[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath).pipe(res);
}

async function handle(db: AsyncBlondina, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const handled = await handleBlondinaRequest(db, req, res);
  if (handled) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requested));
  if (!insideRoot(filePath)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return;
    }
    sendFile(res, filePath);
    return;
  }
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Липсва dist/index.html. Пусни npm run build.");
    return;
  }
  sendFile(res, indexPath);
}

async function main(): Promise<void> {
  const db = await openBlondinaSql(loadBlondinaSqlConfig());
  console.log(`CPS база: ${db.path}`);
  let writing = false;
  setInterval(() => {
    if (writing) return;
    writing = true;
    void Promise.resolve(db.appendDueSamples(new Date()))
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        writing = false;
      });
  }, 1_000);

  const server = createServer((req, res) => {
    void handle(db, req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Грешка в базата." }));
    });
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`CPS слуша на http://0.0.0.0:${port}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
