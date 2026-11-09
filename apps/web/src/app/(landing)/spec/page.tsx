import type { Metadata } from "next";
import { Callout, DocShell, DocTable, Section } from "@/landing/components/Doc";
import {
  ASSUMPTIONS,
  BRANCHES,
  CONTRACTS,
  IMPOSSIBLE,
  LIFECYCLE,
  LIMITS,
  NOT_COVERED,
  REFUSALS,
} from "@/landing/lib/facts";

export const metadata: Metadata = {
  title: "Spec | Aruna",
  description: "The limits, closed routes, assumptions, contracts and claim lifecycle behind Aruna.",
};

const TOC = [
  { id: "limits", label: "Limits" },
  { id: "routes", label: "Closed routes" },
  { id: "assumptions", label: "Assumption register" },
  { id: "contracts", label: "Three contracts" },
  { id: "claims", label: "Coverage lifecycle" },
];

export default function SpecPage() {
  return (
    <DocShell
      title="Spec"
      intro={
        <p>
          What Aruna claims, what it does not, and where it relies on trust. Two parties must be trusted: the attestor,
          permanently, and at this stage a dispute arbiter. The words used here are verifiable and reproducible.
        </p>
      }
      toc={TOC}
      other={{ href: "/proof/", label: "See the lab results" }}
    >
      <Section id="limits" title="Limits, stated openly" lead="Listed up front so nobody has to ask.">
        <ul className="grid border-y border-line-2 md:grid-cols-2 md:gap-x-10">
          {LIMITS.map((l) => (
            <li key={l.title} className="border-b border-line-2 py-5 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
              <h3 className="text-xl">{l.title}</h3>
              <p className="mt-2 leading-[1.55] text-slate">{l.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="routes"
        title="Closed detection routes"
        lead="Five routes to detecting a code change without an outside observer were tested. All are closed, so the attestor is a permanent trust assumption."
      >
        <DocTable
          caption="Closed routes"
          head={["Route", "Why it is closed"]}
          rows={IMPOSSIBLE.map((r) => [r.what, r.why])}
        />
        <p className="max-w-[66ch] leading-[1.6] text-slate">
          The measured behaviour behind each row is on the{" "}
          <a href="/proof/#impossible" className="underline underline-offset-4">lab results page</a>.
        </p>
      </Section>

      <Section
        id="assumptions"
        title="Assumption register"
        lead="Every place the system depends on something not proved, with the document it comes from."
      >
        <DocTable
          caption="Assumption register"
          head={["ID", "Assumption", "Status", "Source"]}
          rows={ASSUMPTIONS.map((a) => [a.id, a.assumption, a.status, a.source])}
          mono={[0, 3]}
        />
      </Section>

      <Section
        id="contracts"
        title="Three contracts"
        lead="A per-owner vault cannot hold a shared underwriter pool, cross-owner concentration limits or a freeze beyond its own agents. So the system is split in three. The factory deploys vaults, and adapters translate named actions per protocol."
      >
        <ul className="grid border-y border-line-2 md:grid-cols-3 md:divide-x md:divide-line-2">
          {CONTRACTS.map((c) => (
            <li key={c.name} className="border-b border-line-2 p-6 last:border-b-0 md:border-b-0">
              <p className="mono text-lg">{c.name}</p>
              <p className="label mt-1 text-xs text-muted">{c.scope}</p>
              <p className="mt-4 leading-[1.55] text-slate">{c.holds}</p>
            </li>
          ))}
        </ul>
        <Callout>
          <strong className="font-medium">Refusals return, authorization failures panic.</strong> A panic reverts
          state, so a refusal that panicked could not count toward auto-disable. Policy refusals return a blocked
          outcome and persist their effects.
        </Callout>
        <DocTable
          caption="Canonical refusal reasons"
          head={["Reason", "Counts toward auto-disable", "Why not"]}
          rows={REFUSALS.map((r) => [r.reason, r.counts ? "yes" : "no", r.why ?? ""])}
          mono={[0]}
        />
      </Section>

      <Section
        id="claims"
        title="Coverage lifecycle"
        lead="Coverage is parametric: the payout is recorded exposure times a ratio, capped, with no judgement about whether an upgrade was malicious."
      >
        <ol className="grid max-w-[720px] gap-px border border-line-2 bg-line-2">
          {LIFECYCLE.map((s, i) => (
            <li key={s.step} className="bg-paper p-5">
              <p className="mono">{s.step}</p>
              {s.note && <p className="mt-2 text-sm leading-[1.5] text-slate">{s.note}</p>}
              {i < LIFECYCLE.length - 1 && <span className="sr-only">then</span>}
            </li>
          ))}
        </ol>
        <div className="grid max-w-[720px] gap-px border border-line-2 bg-line-2 sm:grid-cols-2">
          <div className="bg-paper p-5">
            <p className="label text-xs text-muted">{BRANCHES.clean[0]}</p>
            <p className="mt-2">{BRANCHES.clean[1]}</p>
            <p className="mt-1 text-sm text-slate">{BRANCHES.clean[2]}</p>
          </div>
          <div className="bg-paper p-5">
            <p className="label text-xs text-muted">{BRANCHES.disputed[0]}</p>
            <p className="mt-2">{BRANCHES.disputed[1]}</p>
            <p className="mt-1 text-sm text-slate">{BRANCHES.disputed[2]}</p>
            <ul className="mt-3 grid gap-1 border-t border-line-2 pt-3 text-sm">
              <li>{BRANCHES.upheld}</li>
              <li>{BRANCHES.rejected}</li>
            </ul>
          </div>
        </div>
        <h3 className="text-xl">Not covered</h3>
        <ul className="grid max-w-[66ch] gap-2 border-y border-line-2 py-4">
          {NOT_COVERED.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </DocShell>
  );
}
