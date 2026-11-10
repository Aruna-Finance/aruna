// Read-only view of a vault for the public agent page (docs/FRONTEND.md surface 3): no login, no key.
// One view_access_key_list call shows every agent's real permissions as the protocol enforces them;
// the vault's state adds labels, policies and usage. Signs nothing.
import { DEFAULT_ENDPOINTS, RpcTransportError, type Network } from "@aruna/rpc";

export interface AgentView {
  publicKey: string;
  label: string;
  status: "Active" | "Paused" | "Revoked";
  autoDisabled: boolean;
  policy: {
    maxPerTx: string;
    dailyCap: string;
    maxSlippageBps: number;
    allowedTargets: string[];
    maxRiskClass: string;
  };
  /** Absent on vault versions without the spend path. */
  usage: { spentToday: string; reserved: string } | null;
  /** The key as the network sees it. Null when the key no longer exists (revoked). */
  key: { receiver: string; methods: string[]; allowance: string | null } | null;
  /** What the network refuses this agent, whatever it is told to do. */
  cannot: string[];
}

export interface ExposureView {
  target: string;
  /** Total sent to the target and settled, in yoctoNEAR. */
  amount: string;
  /** The target's class when the exposure was last recorded. */
  classAtRecord: string;
}

export interface VaultView {
  vault: string;
  owner: string;
  operator: string | null;
  /** The owner's limits on every agent. Null on vault versions that do not return it. */
  ceiling: { maxPerTx: string; dailyTotal: string; maxRiskClass: string; allowedTargets: string[]; agentAllowance: string } | null;
  /** Settled exposure per target in the ceiling. Null on vault versions without the spend path. */
  exposure: ExposureView[] | null;
  fullAccessKeys: number;
  agents: AgentView[];
  /** Keys on the account that the vault does not know as agents. Should always be empty. */
  unknownKeys: string[];
  operatorCannot: string[];
}

/** A view method on the vault failed in the contract, e.g. a method this vault version lacks. */
export class VaultViewError extends Error {
  constructor(
    readonly method: string,
    detail: string,
  ) {
    super(`${method}: ${detail}`);
    this.name = "VaultViewError";
  }
}

const OPERATOR_CANNOT = [
  "withdraw funds or send them anywhere but the owner",
  "change the owner, or set or remove the operator",
  "loosen an agent's policy or raise the owner's ceiling",
  "resume a paused or auto-disabled agent",
];

export async function readVault(vault: string, opts: { network?: Network; fetch?: typeof fetch; endpoints?: readonly string[]; now?: number } = {}): Promise<VaultView> {
  const endpoints = opts.endpoints ?? DEFAULT_ENDPOINTS[opts.network ?? "testnet"];
  const doFetch = opts.fetch ?? fetch;

  async function query(params: Record<string, unknown>) {
    const attempts: { url: string; error: string }[] = [];
    for (const url of endpoints) {
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "aruna", method: "query", params: { finality: "final", ...params } }),
        });
        const body = await res.json();
        if (body.error) throw new Error(body.error.cause?.name ?? body.error.name ?? "node error");
        return body.result;
      } catch (e) {
        attempts.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }
    throw new RpcTransportError(`${String(params.request_type)}(${vault})`, attempts);
  }

  const view = async (method: string, args: unknown) => {
    const r = await query({ request_type: "call_function", account_id: vault, method_name: method, args_base64: btoa(JSON.stringify(args)) });
    // A contract error (no such method, a panic) comes back as a result with `error`, not as an RPC error.
    if (typeof r.error === "string") throw new VaultViewError(method, r.error);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
  };

  const [config, agents, keyList] = await Promise.all([
    view("get_config", {}),
    view("get_agents", {}),
    query({ request_type: "view_access_key_list", account_id: vault }),
  ]);
  const c = config.ceiling;
  const ceiling: VaultView["ceiling"] = c
    ? { maxPerTx: c.max_per_tx, dailyTotal: c.daily_total, maxRiskClass: c.max_risk_class, allowedTargets: c.allowed_targets, agentAllowance: c.agent_allowance }
    : null;
  let exposure: ExposureView[] | null = null;
  if (ceiling) {
    try {
      const rows = await Promise.all(ceiling.allowedTargets.map(async (target) => [target, await view("get_exposure", { target })] as const));
      exposure = rows
        .filter(([, e]) => e)
        .map(([target, e]) => ({ target, amount: e.amount, classAtRecord: e.class_at_record }));
    } catch (e) {
      if (!(e instanceof VaultViewError && /MethodNotFound/.test(e.message))) throw e;
    }
  }
  const keys = new Map<string, unknown>(keyList.keys.map((k: { public_key: string; access_key: { permission: unknown } }) => [k.public_key, k.access_key.permission]));
  const fullAccessKeys = [...keys.values()].filter((p) => p === "FullAccess" || (typeof p === "object" && p !== null && "GasKeyFullAccess" in p)).length;

  const today = Math.floor((opts.now ?? Date.now()) / 86_400_000);
  const agentViews: AgentView[] = (agents as [string, Record<string, any>][]).map(([publicKey, a]) => {
    const perm = keys.get(publicKey) as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } } | undefined;
    const fc = perm?.FunctionCall;
    const methods = fc?.method_names ?? [];
    return {
      publicKey,
      label: a.label,
      status: a.status,
      autoDisabled: Boolean(a.auto_disabled),
      policy: {
        maxPerTx: a.policy.max_per_tx,
        dailyCap: a.policy.daily_cap,
        maxSlippageBps: a.policy.max_slippage_bps,
        allowedTargets: a.policy.allowed_targets,
        maxRiskClass: a.policy.max_risk_class,
      },
      // The contract resets spent_today on the first spend of a new UTC day (block time / 86,400 s), so a
      // stored total from an earlier day is not today's.
      usage: a.budget ? { spentToday: a.budget.day_index === today ? a.budget.spent_today : "0", reserved: a.budget.reserved } : null,
      key: fc ? { receiver: fc.receiver_id, methods, allowance: fc.allowance } : null,
      cannot: fc
        ? [
            "transfer funds, add keys or deploy code: its key is a function-call key (RequiresFullAccess)",
            `call any contract other than ${fc.receiver_id} (ReceiverMismatch)`,
            `call any method other than ${methods.join(", ")} (MethodNameMismatch)`,
            "attach a deposit to a call (DepositWithFunctionCall)",
          ]
        : ["sign anything: its key has been deleted from the vault"],
    };
  });

  return {
    vault,
    owner: config.owner,
    operator: config.operator ?? null,
    ceiling,
    exposure,
    fullAccessKeys,
    agents: agentViews,
    unknownKeys: [...keys.keys()].filter((k) => !agentViews.some((a) => a.publicKey === k)),
    operatorCannot: OPERATOR_CANNOT,
  };
}
