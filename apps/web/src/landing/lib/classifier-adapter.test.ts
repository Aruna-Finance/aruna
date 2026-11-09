import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_ACCOUNTS, lookup } from "./classifier-adapter";

const ZERO = "11111111111111111111111111111111";
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "aruna", result }));

afterEach(() => vi.unstubAllGlobals());

describe("lookup", () => {
  it("classifies live through the engine and returns a live result", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(String(init.body));
      if (params.request_type === "view_account") return ok({ block_height: 5, code_hash: ZERO, global_contract_account_id: "o.testnet" });
      if (params.request_type === "view_access_key_list") return ok({ block_height: 5, keys: [] });
      return ok({ block_height: 5, code_base64: "AGFzbQEAAAA=", hash: "RESOLVED" });
    });
    const r = await lookup("u.testnet", "testnet");
    expect(r.ok && r.source).toBe("live");
    expect(r.ok && r.classification.class).toBe("global_by_account");
    expect(r.ok && r.classification.evidence.monitoredCodeHash).toBe(ZERO);
  });

  it("a transport failure is a normal result, not an exception", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const r = await lookup("u.testnet", "testnet");
    expect(r.ok).toBe(false);
  });

  it("an invalid account id never reaches the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await lookup("Not Valid", "mainnet")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("offers the live testnet fixtures as examples", () => {
    expect(EXAMPLE_ACCOUNTS).toContain("fx-guser.arunafi.testnet");
  });
});
