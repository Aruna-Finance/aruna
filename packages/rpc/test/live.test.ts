// Calls public RPC. Runs only with ARUNA_LIVE=1, the convention apps/web already uses.
import { describe, expect, it } from "vitest";
import { classify } from "@aruna/classifier-core";
import { createFetchReader } from "../src/index.js";

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ARUNA_LIVE === "1";

describe.runIf(live)("live RPC", () => {
  it("mainnet wrap.near has local code that parses", async () => {
    const c = await classify("wrap.near", createFetchReader({ network: "mainnet" }));
    expect(c.evidence.monitoredCodeHash).not.toBe("11111111111111111111111111111111");
    expect(c.evidence.wasmParsed).toBe(true);
    expect(c.evidence.checkedAtBlock).toBeGreaterThan(0);
  }, 30_000);

  it("testnet: a name that does not exist classifies unknown", async () => {
    const c = await classify("definitely-not-here-xyz.testnet", createFetchReader({ network: "testnet" }));
    expect(c.class).toBe("unknown");
  }, 30_000);

  it("every built-in endpoint answers status on its own network", async () => {
    for (const network of ["mainnet", "testnet"] as const) {
      for (const url of createFetchReader({ network }).endpoints) {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }) });
        const body = await r.json();
        expect(body.result?.chain_id, `${url} answered ${r.status} ${JSON.stringify(body).slice(0, 200)}`).toBe(network);
      }
    }
  }, 60_000);
});
