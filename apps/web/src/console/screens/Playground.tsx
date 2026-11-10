"use client";

import Link from "next/link";
import { AUTO_DISABLE_REASONS } from "@aruna/sdk";
import { useVaultView } from "../useVaultView";
import { agentPageHref } from "../ui/agentPageHref";
import { CopyBlock } from "../ui/CopyBlock";
import { Panel } from "../ui/Panel";
import { DEMO_VAULT } from "../data/story";

// A browser cannot sign for an agent key, and it must not run the vault's policy checks itself (CLAUDE.md rule 10).
// So this page does not simulate anything. It reads the real testnet vault the two example agents act on, and
// gives the command to run each one. aruna_simulate is a free view of the vault contract, reached through the MCP
// server, not from this page.

const EXAMPLES = [
  {
    file: "honest-agent.ts",
    label: "honest",
    what: "A rule-based loop: fetch, decide, simulate, spend, and log refusals with their reason and the target's class.",
  },
  {
    file: "injected-agent.ts",
    label: "injected",
    what: "The same policy, with poisoned text in the context it reads. It tries to send funds to an unlisted address and is refused, then the vault pauses it once weighted refusals reach the threshold. Expected: five refusals that return, agent_auto_disabled on the fifth, and then even an in-policy swap is refused.",
  },
];

export function Playground() {
  const state = useVaultView(DEMO_VAULT);

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Simulate and injection</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Run the two example agents from your terminal, then read what the vault recorded. This page reads the same testnet vault, live,
        so the result is checkable without trusting this page.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Run an agent" aside={<span className="text-sm text-muted">Neither needs a paid API key</span>}>
          <div className="grid gap-6">
            {EXAMPLES.map((e) => (
              <div key={e.file}>
                <p className="mono text-sm">{e.file}</p>
                <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{e.what}</p>
                <div className="mt-3">
                  <CopyBlock text={`node examples/${e.file}`} />
                </div>
              </div>
            ))}
            <p className="max-w-[80ch] text-sm text-muted">
              To run the injected agent again, the owner resumes it first: <span className="mono">node examples/resume-agent.ts injected</span>.
              An operator cannot.
            </p>
          </div>
        </Panel>

        <Panel title={`What the vault recorded on ${DEMO_VAULT}`} aside={<span className="text-sm text-muted">Live testnet read</span>}>
          {state.status === "loading" && <p className="text-muted">Reading the vault.</p>}
          {state.status === "error" && (
            <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the vault. {state.message}.</p>
          )}
          {state.status === "ok" && (
            <>
              <dl className="mb-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted">Owner</dt>
                  <dd className="mono break-all">{state.view.owner}</dd>
                </div>
                <div>
                  <dt className="text-muted">Operator</dt>
                  <dd className="mono break-all">{state.view.operator ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Full-access keys</dt>
                  <dd className="mono">{state.view.fullAccessKeys}</dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {["Agent", "Status", "Public key"].map((h) => (
                        <th key={h} className="border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.view.agents.map((a) => (
                      <tr key={a.publicKey}>
                        <td className="border-b border-line px-3 py-3">
                          <Link href={agentPageHref(state.view.vault, a.publicKey)} className="font-medium underline underline-offset-4">
                            {a.label}
                          </Link>
                        </td>
                        <td className={`border-b border-line px-3 py-3 ${a.status !== "Active" || a.autoDisabled ? "text-dawn-ink" : ""}`}>
                          {a.autoDisabled ? "Auto-disabled" : a.status}
                        </td>
                        <td className="mono border-b border-line px-3 py-3 text-sm break-all">{a.publicKey}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="mt-5 max-w-[80ch] text-sm text-muted">
            A paused, auto-disabled injected agent is the product working: the refusals were returned and recorded, not thrown.
          </p>
        </Panel>

        <Panel title="What counts toward auto-disable">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            Only agent-caused refusals count, so an honest agent is not disabled for a target reclassified under it or a freeze:
          </p>
          <p className="mono mt-3 text-sm">{AUTO_DISABLE_REASONS.join(", ")}</p>
        </Panel>

        <Panel title="Simulate before you spend">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            <span className="mono">aruna_simulate</span> is a free view that runs the vault&apos;s own checks without a transaction, so a
            refusal costs no gas. It is reached through the MCP server or the SDK with an agent key, not from this page, because the
            checks belong to the contract and a second copy in the browser would disagree with it. Its result is not binding: state can
            change before the transaction lands.
          </p>
        </Panel>
      </div>
    </article>
  );
}
