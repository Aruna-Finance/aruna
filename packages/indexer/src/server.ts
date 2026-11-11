// The HTTP server over the store (plan U3). Ingest and serving share one process and one SQLite file.

import { createServer, type Server } from "node:http";
import { handle } from "./routes.js";
import type { Store } from "./store.js";

export async function startServer(o: { store: Store; port: number; host?: string }): Promise<{ server: Server; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let reply;
    try {
      reply = handle(o.store, req.method ?? "GET", req.url ?? "/");
    } catch (e) {
      reply = { status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "internal error" }) };
      console.error(e);
    }
    res.writeHead(reply.status, reply.headers).end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(o.port, o.host ?? "0.0.0.0", resolve));
  return { server, close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) };
}
