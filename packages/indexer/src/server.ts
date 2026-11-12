// The HTTP server over the store (plan U3). Ingest and serving share one process and one database.

import { createServer, type Server } from "node:http";
import { handle } from "./routes.js";
import type { Store } from "./store.js";

/** The store, or a function that returns it once it is open (the server starts first, so /health answers while the database is down: plan KTD7). */
export type StoreRef = Store | (() => Store | null);

export async function startServer(o: { store: StoreRef; port: number; host?: string }): Promise<{ server: Server; close: () => Promise<void> }> {
  const current = () => (typeof o.store === "function" ? o.store() : o.store);
  const server = createServer(async (req, res) => {
    let reply;
    try {
      reply = await handle(current(), req.method ?? "GET", req.url ?? "/");
    } catch (e) {
      reply = { status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "internal error" }) };
      console.error(e);
    }
    res.writeHead(reply.status, reply.headers).end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(o.port, o.host ?? "0.0.0.0", resolve));
  return { server, close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) };
}
