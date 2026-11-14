import { REFUSALS } from "@/landing/lib/facts";
import { Panel } from "../ui/Panel";
import { PageHeader } from "../ui/PageHeader";

// Static reference. Tool names, inputs and returns are copied from docs/MCP.md; reasons from docs/CONTRACTS.md
// through landing/lib/facts. Nothing here is invented, and console/developers.test.ts checks the reason set
// against @aruna/sdk.

const KEYLESS = [
  { tool: "aruna_check_target", input: "account_id, optional network", returns: "class, evidence, one-line reason" },
  { tool: "aruna_watch_target", input: "account_id", returns: "resolved code hash now, state of all four drift channels, last observed change" },
  { tool: "aruna_explain_class", input: "class", returns: "what the class means and what can still change" },
  {
    tool: "aruna_read_vault",
    input: "vault_id, optional network",
    returns: "owner, operator and ceiling; every agent with policy, status, usage and key permissions; what agents and the operator cannot do; exposure per target",
  },
];

const VAULT = [
  { tool: "aruna_simulate", input: "action params", returns: "verdict allow or block, reason, target class, premium impact" },
  { tool: "aruna_spend", input: "action params", returns: "execution result, or a refusal with its reason" },
  { tool: "aruna_budget", input: "none", returns: "balance, spent today, reserved, remaining" },
  { tool: "aruna_exposure", input: "none", returns: "exposure per target, each with its class" },
];

const LEFT_OUT = [
  ["Coverage purchase", "An owner action, done from the console with the owner's account. Never reachable by an agent key, in any layer."],
  ["Approval queues", "aruna_simulate has two verdicts, allow and block. There is no needs_approval."],
  ["Receipts", "No module backs them, so they are dropped until one exists."],
  ["Key management", "The server never creates accounts, adds keys or funds allowances."],
  ["Free-form (target, method, args)", "It would make the vault a generic proxy and destroy containment."],
  ["Automatic retry on a policy refusal", "A refusal means the agent must not do it. Stale-class refresh is different and is handled in the SDK, once."],
];

const th = "border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap";
const td = "border-b border-line px-3 py-3 align-top";

function ToolTable({ rows }: { rows: { tool: string; input: string; returns: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th className={th}>Tool</th>
            <th className={th}>Input</th>
            <th className={th}>Returns</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tool}>
              <td className={`${td} mono whitespace-nowrap`}>{r.tool}</td>
              <td className={`${td} text-sm`}>{r.input}</td>
              <td className={`${td} text-sm`}>{r.returns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Developers() {
  return (
    <article>
      <PageHeader title="SDK and MCP">
        Tools for agents whose framework speaks tool-calling. They wrap <span className="mono">@aruna/sdk</span>.
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Keyless tools" aside={<span className="text-sm text-muted">No account, vault or key</span>}>
          <p className="mb-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            Usable by any agent on NEAR, including agents that never touch our vault. <span className="mono">aruna_check_target</span>{" "}
            answers whether a contract can still change under you, and hash-based checks are blind to{" "}
            <span className="mono">global_by_account</span>.
          </p>
          <ToolTable rows={KEYLESS} />
        </Panel>

        <Panel title="Vault tools" aside={<span className="text-sm text-muted">Need a registered agent key</span>}>
          <ToolTable rows={VAULT} />
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            <span className="mono">aruna_simulate</span> is a free view running the same checks without a transaction, so a refusal costs
            no gas. Its result is not binding: state can change before the transaction lands. It also returns the target&apos;s recorded
            class and the premium impact of the action, which is the policy-to-price chain at the moment of decision.
          </p>
        </Panel>

        <Panel title="Refusal reasons" aside={<span className="text-sm text-muted">SDK codes are the contract values without ARUNA_</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Contract value</th>
                  <th className={th}>SDK code</th>
                  <th className={th}>Counts toward auto-disable</th>
                </tr>
              </thead>
              <tbody>
                {REFUSALS.map((r) => (
                  <tr key={r.reason}>
                    <td className={`${td} mono`}>{r.reason}</td>
                    <td className={`${td} mono`}>{r.reason.replace(/^ARUNA_/, "")}</td>
                    <td className={`${td} text-sm`}>{r.counts ? "Yes" : `No: ${r.why}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            A policy refusal is a successful tool call returning <span className="mono">verdict: &quot;block&quot;</span> with a reason.
            Only authorization and transport failures are tool errors. Flattening refusals into errors teaches agents to catch and
            ignore them.
          </p>
        </Panel>

        <Panel title="Deliberately left out">
          <ul className="grid gap-2 text-[15px]">
            {LEFT_OUT.map(([name, why]) => (
              <li key={name} className="grid gap-x-4 border-t border-line pt-2 sm:grid-cols-[18rem_1fr]">
                <span className="font-medium">{name}</span>
                <span className="text-slate">{why}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Run it">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            Two runnable examples ship in <span className="mono">examples/</span>, and neither needs a paid API key:{" "}
            <span className="mono">honest-agent.ts</span> is a rule-based loop that simulates, spends and logs refusals with their
            reason, and <span className="mono">injected-agent.ts</span> is the same loop with poisoned text in its context. The second
            attempts a payout to an unlisted address and is refused twice, once by the protocol and once by the vault.
          </p>
        </Panel>
      </div>
    </article>
  );
}
