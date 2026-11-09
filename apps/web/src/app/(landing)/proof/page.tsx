import type { Metadata } from "next";
import { Callout, DocShell, DocTable, Section } from "@/landing/components/Doc";
import { Disclosure } from "@/shared/Disclosure";
import {
  ACCESS_KEY_ROWS,
  CURRENT_CODE_ROWS,
  GAS_KEY_ROWS,
  GLOBAL_ROWS,
  IMMUTABLE_CONDITIONS,
  IMPORT_ROWS,
  IMPOSSIBLE,
  LAB,
  NEP141_PANIC,
  TOCTOU_ROWS,
} from "@/landing/lib/facts";

export const metadata: Metadata = {
  title: "Lab results | Aruna",
  description: "What the Aruna lab measured on NEAR, with the exact errors the node returned.",
};

const TOC = [
  { id: "setup", label: "Setup" },
  { id: "impossible", label: "What is impossible" },
  { id: "keys", label: "Access keys" },
  { id: "immutability", label: "Immutability" },
  { id: "toctou", label: "TOCTOU window" },
  { id: "global", label: "Global contracts" },
  { id: "introspection", label: "Self-introspection" },
  { id: "gas-keys", label: "Gas keys" },
];

export default function ProofPage() {
  return (
    <DocShell
      title="Lab results"
      intro={
        <p>
          Everything on this page was run in our own lab. The error strings are what the node returned, copied
          verbatim from <span className="mono">docs/NEAR-FACTS.md</span>. Anything not listed here is not assumed.
        </p>
      }
      toc={TOC}
      other={{ href: "/spec/", label: "Read the spec" }}
    >
      <Section id="setup" title="Setup and scope">
        <DocTable
          caption="Lab environment"
          head={["Item", "Value"]}
          rows={[
            ["Sandbox", LAB.sandbox],
            ["Node", LAB.node],
            ["Protocol version", LAB.protocol],
            ["Topology", `${LAB.shard}, root account sandbox (parent.test.near becomes parent.sandbox)`],
          ]}
          mono={[1]}
        />
        <Callout>
          <strong className="font-medium">Older model.</strong> The access-key rows were tested with gas keys on
          sub-accounts. The product now uses classic function-call keys on a contract account. The permission
          semantics are expected to carry over, but tests T5 to T9 are owed before relying on them. Testnet may also
          behave differently from the lab.
        </Callout>
      </Section>

      <Section
        id="impossible"
        title="What is impossible"
        lead="Five routes, each tested, each closed. Detecting a code change therefore requires an off-chain observer, and that is permanent under the current protocol."
      >
        <DocTable
          caption="Closed routes"
          head={["Impossible", "Why"]}
          rows={IMPOSSIBLE.map((r) => [r.what, r.why])}
        />
      </Section>

      <Section
        id="keys"
        title="What a function-call key can and cannot do"
        lead="Tested from an agent key restricted to one method on one contract."
      >
        <DocTable
          caption="Agent key actions and the exact errors"
          head={["Action", "Result", "Exact error", "On chain"]}
          rows={ACCESS_KEY_ROWS.map((r) => [r.action, r.result, r.error, r.onChain])}
          mono={[0, 2]}
        />
        <Callout>
          The first five rows are rejected by the node at validation, so their transaction hashes never reach the
          chain and cannot be looked up in an explorer. Only the parent case leaves an on-chain trace. Evidence is a
          re-runnable script that prints the RPC errors.
        </Callout>
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          A restricted key cannot attach a deposit at all, and NEP-141 requires exactly 1 yoctoNEAR for{" "}
          <span className="mono">ft_transfer</span> and <span className="mono">ft_transfer_call</span>. With deposit 0
          the contract panics: <span className="mono">{NEP141_PANIC}</span>. So an agent structurally cannot move
          NEP-141 tokens itself, and a vault holding pre-funded assets is the only possible architecture.
        </p>
      </Section>

      <Section
        id="immutability"
        title="Immutability needs three checks"
        lead="No full-access key does not mean immutable: a locked contract can still upgrade itself if its code exposes an authorized update method."
      >
        <ol className="grid max-w-[80ch] gap-2 border-y border-line-2 py-4">
          {IMMUTABLE_CONDITIONS.map((c, i) => (
            <li key={c} className="flex gap-4">
              <span className="label text-sm text-muted">{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ol>
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          Absence is sound: a contract cannot call a host function it does not import. Presence is weaker. Measured on
          7 November 2026 with near-sdk 5.30.1 (release, LTO, no wasm-opt) on a one-method contract:
        </p>
        <DocTable
          caption="Host function imports by how a key is added"
          head={["How it adds one function-call key", "promise_batch_action imports"]}
          rows={IMPORT_ROWS.map((r) => [r.how, r.imports])}
          mono={[0]}
        />
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          So the vault must use the low-level functions, and many ordinary near-sdk contracts carry these imports with
          no upgrade route. Open: a contract able to delete its own account frees the name, and a parent can recreate a
          sub-account with other code. Lab test T9 must confirm the behaviour.
        </p>
      </Section>

      <Section
        id="toctou"
        title="The TOCTOU window"
        lead="The gate transaction lands in block G, the gate runs at G+1, the target's method runs at G+2. Measured single-shard."
      >
        <DocTable
          caption="Which version runs by when the v2 deploy lands"
          head={["v2 deploy lands at", "version() returns"]}
          rows={TOCTOU_ROWS.map((r) => [r.lands, r.version])}
          mono={[0]}
        />
        <Callout>
          The window is at least 3 blocks after the gate transaction, plus the delay between the observer&apos;s check
          and submission. This is a lower bound. Multi-shard is untested. The gate can refuse the next transaction to a
          changed target; it cannot stop one already in flight.
        </Callout>
      </Section>

      <Section
        id="global"
        title="Global contracts: where monitors go blind"
        lead="By account id, the owner redeploys v2 and no transaction touches the user's account."
      >
        <DocTable
          caption="Before and after the owner redeploys"
          head={["Field", "Before", "After"]}
          rows={GLOBAL_ROWS.map((r) => [r.field, r.before, r.after])}
          mono={[0, 1, 2]}
        />
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          New code is active 3 blocks after the owner&apos;s deploy. A trigger keyed on{" "}
          <span className="mono">view_account.code_hash</span> never sees this change. Watch{" "}
          <span className="mono">view_code</span> (the resolved hash) or <span className="mono">DeployGlobalContract</span>{" "}
          on the owner. An account with no contract of its own also reports a zero code_hash, so a zero hash does not
          mean no code. By hash, an account that still has a full-access key can re-point it with{" "}
          <span className="mono">UseGlobalContract</span> (tested: v2 to v1 succeeded).
        </p>
      </Section>

      <Section
        id="introspection"
        title="current_contract_code() is self-introspection only"
        lead="A host function from nearcore 2.10 (protocol 82), behind the deterministic-account-ids feature."
      >
        <DocTable
          caption="What current_contract_code returns"
          head={["Account state", "Returns"]}
          rows={CURRENT_CODE_ROWS.map((r) => [r.state, r.returns])}
          mono={[1]}
        />
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          After the owner redeploys v2 on the by-account path, <span className="mono">version()</span> returns v2 and{" "}
          <span className="mono">view_code</span> changes, but this function still returns the account id. It must not
          be used to verify a target: the method wrapping it is written by the target, and malicious code can lie.
        </p>
      </Section>

      <Section id="gas-keys" title="Gas keys (NEP-611)">
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          Aruna does not use gas keys. Agents are function-call keys on the vault with a classic allowance. The lab
          results are kept because the facts remain true. Gas key funds are one-way: an agent without a full key can
          never withdraw them.
        </p>
        <Disclosure title="Show the gas key results" className="border-y border-line-2 py-4">
          <div className="mt-4">
            <DocTable
              caption="Gas key scenarios"
              head={["Scenario", "Result"]}
              rows={GAS_KEY_ROWS.map((r) => [r.scenario, r.result])}
              mono={[0, 1]}
            />
          </div>
        </Disclosure>
      </Section>
    </DocShell>
  );
}
