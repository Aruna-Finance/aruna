import { describe, expect, it } from "vitest";
import { readVault } from "../src/index.js";

const enc = (v: unknown) => [...new TextEncoder().encode(JSON.stringify(v))];
const policy = { max_per_tx: "5", daily_cap: "10", max_slippage_bps: 50, allowed_targets: ["swap.testnet"], max_risk_class: "immutable_verified" };

function node(agents: unknown, keys: unknown[]) {
  return (async (_url: string, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body));
    let result: unknown;
    if (params.request_type === "view_access_key_list") result = { block_height: 1, keys };
    else if (params.method_name === "get_config") result = { result: enc({ owner: "client.testnet", operator: "company.testnet" }) };
    else result = { result: enc(agents) };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "aruna", result }));
  }) as typeof fetch;
}

describe("readVault", () => {
  it("joins agents with their real keys and says what each cannot do", async () => {
    const v = await readVault("v.factory.testnet", {
      endpoints: ["https://x"],
      fetch: node(
        [["ed25519:A", { label: "trader", status: "Active", policy, budget: { spent_today: "3", reserved: "1" } }], ["ed25519:B", { label: "old", status: "Revoked", policy }]],
        [{ public_key: "ed25519:A", access_key: { permission: { FunctionCall: { receiver_id: "v.factory.testnet", method_names: ["spend", "refresh_class"], allowance: "250" } } } }],
      ),
    });
    expect(v.fullAccessKeys).toBe(0);
    expect(v.unknownKeys).toEqual([]);
    expect(v.agents[0].key?.methods).toEqual(["spend", "refresh_class"]);
    expect(v.agents[0].usage).toEqual({ spentToday: "3", reserved: "1" });
    expect(v.agents[0].cannot.join(" ")).toMatch(/MethodNameMismatch/);
    expect(v.agents[1].key).toBeNull();
    expect(v.agents[1].cannot[0]).toMatch(/deleted/);
    expect(v.operatorCannot.length).toBe(4);
  });

  it("reads a vault version without the spend path, and flags a key the vault does not know", async () => {
    const v = await readVault("v.factory.testnet", {
      endpoints: ["https://x"],
      fetch: node([["ed25519:A", { label: "t", status: "Active", policy }]], [
        { public_key: "ed25519:A", access_key: { permission: { FunctionCall: { receiver_id: "v", method_names: ["spend"], allowance: null } } } },
        { public_key: "ed25519:Z", access_key: { permission: "FullAccess" } },
      ]),
    });
    expect(v.agents[0].usage).toBeNull();
    expect(v.fullAccessKeys).toBe(1);
    expect(v.unknownKeys).toEqual(["ed25519:Z"]);
  });
});
