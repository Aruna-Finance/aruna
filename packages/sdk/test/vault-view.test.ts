import { describe, expect, it } from "vitest";
import { readVault, VaultViewError } from "../src/index.js";

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
      now: 20_000 * 86_400_000 + 5,
      fetch: node(
        [["ed25519:A", { label: "trader", status: "Active", policy, budget: { spent_today: "3", reserved: "1", day_index: 20_000 } }], ["ed25519:C", { label: "yesterday", status: "Active", policy, budget: { spent_today: "4", reserved: "0", day_index: 19_999 } }], ["ed25519:B", { label: "old", status: "Revoked", policy }]],
        [{ public_key: "ed25519:A", access_key: { permission: { FunctionCall: { receiver_id: "v.factory.testnet", method_names: ["spend", "refresh_class"], allowance: "250" } } } }],
      ),
    });
    expect(v.fullAccessKeys).toBe(0);
    expect(v.unknownKeys).toEqual([]);
    expect(v.agents[0].key?.methods).toEqual(["spend", "refresh_class"]);
    expect(v.agents[0].usage).toEqual({ spentToday: "3", reserved: "1" });
    expect(v.agents[0].cannot.join(" ")).toMatch(/MethodNameMismatch/);
    expect(v.agents[1].usage?.spentToday).toBe("0");
    expect(v.agents[2].key).toBeNull();
    expect(v.agents[2].cannot[0]).toMatch(/deleted/);
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

  it("reads the ceiling and the exposure per ceiling target", async () => {
    const ceiling = { max_per_tx: "5", daily_total: "30", max_risk_class: "local_upgradeable", allowed_targets: ["swap.testnet", "idle.testnet"], agent_allowance: "9" };
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(String(init.body));
      let result: unknown;
      if (params.request_type === "view_access_key_list") result = { block_height: 1, keys: [] };
      else if (params.method_name === "get_config") result = { result: enc({ owner: "o", operator: null, ceiling }) };
      else if (params.method_name === "get_exposure") {
        const { target } = JSON.parse(atob(params.args_base64));
        result = { result: enc(target === "swap.testnet" ? { amount: "7", class_at_record: "local_upgradeable", first_seen: 1, last_updated: 2 } : null) };
      } else result = { result: enc([]) };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "aruna", result }));
    }) as typeof fetch;
    const v = await readVault("v.factory.testnet", { endpoints: ["https://x"], fetch: fetchFn });
    expect(v.ceiling).toEqual({ maxPerTx: "5", dailyTotal: "30", maxRiskClass: "local_upgradeable", allowedTargets: ["swap.testnet", "idle.testnet"], agentAllowance: "9" });
    expect(v.exposure).toEqual([{ target: "swap.testnet", amount: "7", classAtRecord: "local_upgradeable" }]);
  });

  it("reports no exposure for a vault version without get_exposure, and fails loudly on other contract errors", async () => {
    const ceiling = { max_per_tx: "5", daily_total: "30", max_risk_class: "local_upgradeable", allowed_targets: ["swap.testnet"], agent_allowance: "9" };
    const make = (error: string) =>
      (async (_url: string, init: RequestInit) => {
        const { params } = JSON.parse(String(init.body));
        let result: unknown;
        if (params.request_type === "view_access_key_list") result = { block_height: 1, keys: [] };
        else if (params.method_name === "get_config") result = { result: enc({ owner: "o", operator: null, ceiling }) };
        else if (params.method_name === "get_exposure") result = { error, logs: [], block_height: 1 };
        else result = { result: enc([]) };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "aruna", result }));
      }) as typeof fetch;
    const old = await readVault("v", { endpoints: ["https://x"], fetch: make("wasm execution failed with error: MethodResolveError(MethodNotFound)") });
    expect(old.exposure).toBeNull();
    await expect(readVault("v", { endpoints: ["https://x"], fetch: make("Smart contract panicked: boom") })).rejects.toThrow(VaultViewError);
  });
});
