"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/shared/Button";
import { toast } from "@/shared/Toaster";
import { COVERAGE_ASSUME } from "../data/coverage";
import { coverageStore, groupOf } from "../data/coverage-mock";
import { concentration, withdrawable, worstCasePayout, type GroupBy } from "../data/pool";
import { poolStore } from "../data/pool-mock";
import { n0 } from "../fmt";
import { useTx } from "../TxContext";
import { useClaims } from "../useClaims";
import { useCoverage } from "../useCoverage";
import { useTargets } from "../useTargets";
import { CLASS_ORDER } from "../classInfo";
import { ClassTag } from "../ui/ClassTag";
import { HeartbeatAlert } from "../ui/CoverageNotes";
import { NumberField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { TokenIcon } from "../ui/Token";

const SIGNER = "underwriter.testnet";
const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const CLASSES = CLASS_ORDER.filter((c) => c !== "unknown");

const BY: { id: GroupBy; label: string }[] = [
  { id: "code_hash", label: "Implementation" },
  { id: "global_contract", label: "Global contract owner" },
];

export function Pool() {
  const { attestors, policies } = useCoverage();
  const { reports, claims } = useClaims();
  const { list } = useTargets();
  const pool = useSyncExternalStore(poolStore.subscribe, poolStore.get, poolStore.get);
  const { open } = useTx();
  const [by, setBy] = useState<GroupBy>("code_hash");
  const [amount, setAmount] = useState(0);
  const [picked, setPicked] = useState<Record<string, boolean>>({ immutable_verified: true, local_upgradeable: true, global_by_account: false });
  const [wd, setWd] = useState(0);

  // policies is in the dependency list so the figures follow a coverage purchase
  const book = useMemo(() => coverageStore.book(), [policies]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalLimits = coverageStore.totalLimits();
  const maxCover = pool.capital * COVERAGE_ASSUME.capitalAdequacyK;
  const premiums = book.reduce((s, p) => s + p.premiumPaid, 0);
  const paidOut = claims.filter((c) => c.status === "paid").reduce((s, c) => s + c.payout, 0);
  const mine = pool.deposits.filter((d) => d.account === SIGNER).reduce((s, d) => s + d.amount, 0);
  const share = pool.capital ? mine / pool.capital : 0;
  const pending = reports.some((r) => r.status === "challenge_window" || r.status === "disputed");
  const w = withdrawable(pool.capital, totalLimits, pending);
  const hasLive = policies.length > 0 || book.length > 0;

  const keyOf = (target: string) => {
    if (by === "code_hash") return groupOf(target);
    const ref = list.find((t) => t.id === target)?.classification.evidence.codeRef;
    return ref?.kind === "global_account" ? ref.ownerAccount : undefined;
  };
  const groups = concentration(book, keyOf, pool.capital);
  const top = concentration(book, groupOf, pool.capital)[0];
  const scale = Math.max(...groups.map((g) => g.limit), groups[0]?.cap ?? 1) * 1.08;
  const worst = top ? worstCasePayout(top.limit) : 0;

  function attempt(f: () => void, done: string) {
    try {
      f();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The pool refused the call.");
    }
  }

  function deposit() {
    const classes = CLASSES.filter((c) => picked[c]);
    if (!(amount > 0) || !classes.length) {
      toast.error("Enter an amount and choose at least one class.");
      return;
    }
    open({
      title: `Deposit ${n0(amount)} USDC?`,
      signer: SIGNER,
      receiver: "usdc.testnet",
      actions: ["ft_transfer_call to aruna.testnet, 1 yoctoNEAR"],
      note: `Accepts ${classes.join(", ")}. Capital stays locked while it backs open coverage.`,
      okLabel: "Deposit capital",
      onOk: () => attempt(() => poolStore.deposit(SIGNER, amount, classes), "Deposit added to the pool."),
    });
  }

  function withdraw() {
    if (!(wd > 0)) return;
    open({
      title: `Withdraw ${n0(wd)} USDC?`,
      signer: SIGNER,
      receiver: "aruna.testnet",
      actions: ["withdraw capital"],
      okLabel: "Withdraw capital",
      onOk: () => attempt(() => poolStore.withdraw(SIGNER, wd, pending), "Withdrawn from the pool."),
    });
  }

  const tiles: { label: string; value: string; sub: React.ReactNode }[] = [
    { label: "Pool capital", value: n0(pool.capital), sub: `Your share ${pct(share)}` },
    { label: "Coverage sold", value: n0(totalLimits), sub: `${pct(maxCover ? totalLimits / maxCover : 0, 0)} of the ${n0(maxCover)} limit` },
    { label: "Premiums collected", value: n0(premiums), sub: `Your share ${n0(Math.round(premiums * share))} USDC` },
    { label: "Claims paid", value: n0(paidOut), sub: "None unpaid" },
  ];

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">How much of the pool rests on one implementation</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Code drift claims are correlated. When one popular implementation changes, every exposed agent claims in the same block, so the
        limit applies per implementation as well as per address.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <HeartbeatAlert attestors={attestors} />

        <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="bg-paper p-6">
              <dt className="text-sm text-muted">{t.label}</dt>
              <dd className="mt-2 text-[28px] leading-none">
                {t.value}
                <small className="ml-1 text-base text-muted">USDC</small>
              </dd>
              <p className="mt-2 text-sm text-muted">{t.sub}</p>
            </div>
          ))}
        </dl>

        <Panel
          title="Concentration"
          aside={
            <div className="flex gap-px border border-line-2 bg-line-2" role="group" aria-label="Group by">
              {BY.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={by === b.id}
                  onClick={() => setBy(b.id)}
                  className={`label cursor-pointer px-3 py-1.5 text-xs ${by === b.id ? "bg-ink text-paper" : "bg-paper"}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          }
        >
          <p className="mb-5 max-w-[80ch] text-sm text-slate">
            Coverage limit against the {pct(COVERAGE_ASSUME.concentrationPct, 0)} of capital allowed for each group. The limit is an
            assumption: it must come from the simulation, then be locked.
          </p>
          {groups.length ? (
            <div className="grid gap-4">
              {groups.map((g) => (
                <div key={g.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,16rem)_1fr_auto]">
                  <div className="min-w-0">
                    <span className="mono block text-sm break-all">{g.key}</span>
                    <span className="text-sm text-muted">
                      {g.policies} {g.policies > 1 ? "policies" : "policy"} on {g.targets.join(", ")}
                    </span>
                  </div>
                  <div
                    className="relative h-2.5 bg-fog"
                    role="img"
                    aria-label={`${n0(g.limit)} of ${n0(g.cap)} USDC`}
                  >
                    <div className={`h-full ${g.limit / g.cap > 0.85 ? "bg-dawn" : "bg-ink"}`} style={{ width: `${(g.limit / scale) * 100}%` }} />
                    <i className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${(g.cap / scale) * 100}%` }} aria-hidden />
                  </div>
                  <span className="mono text-sm whitespace-nowrap">
                    {n0(g.limit)} <span className="text-muted">{pct(g.share)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing in this group. Only targets on a global contract appear here.</p>
          )}
          <p className="mt-5 text-sm text-muted">Bar turns amber above 85% of the group limit. The vertical mark is the group limit.</p>
        </Panel>

        <Panel title="If the largest group changes today">
          {top ? (
            <>
              <p className="text-[28px] leading-none">
                {n0(worst)}
                <small className="ml-1 text-base text-muted">USDC</small>
              </p>
              <p className="mt-3 max-w-[80ch] text-sm leading-[1.6] text-slate">
                Most it could pay at an {COVERAGE_ASSUME.defaultPayoutBps / 100}% ratio if every limit is fully exposed on{" "}
                <span className="mono">{top.key}</span>. That is {pct(pool.capital ? worst / pool.capital : 0)} of pool capital.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">No live coverage, so nothing to pay.</p>
          )}
          <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Capital adequacy</dt>
              <dd>
                Total coverage at most {COVERAGE_ASSUME.capitalAdequacyK} x capital. k is an open question in the decisions doc.
              </dd>
            </div>
            <div>
              <dt className="text-muted">Attestors</dt>
              <dd className="grid gap-1">
                {attestors.map((a) => (
                  <span key={a.id}>
                    <span className="mono">{a.id}</span>{" "}
                    {a.heartbeatAgeBlocks > COVERAGE_ASSUME.heartbeatMaxAgeBlocks ? (
                      <span className="text-dawn-ink">silent, {n0(a.heartbeatAgeBlocks)} blocks</span>
                    ) : (
                      <span className="text-muted">{n0(a.heartbeatAgeBlocks)} blocks ago</span>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </Panel>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          <Panel title="Add capital">
            <p className="mb-5 text-sm text-slate">Choose which risk classes your capital may back.</p>
            <div className="grid gap-4">
              <NumberField label="Amount" suffix={<TokenIcon t="USDC" />} value={amount} onChange={setAmount} />
              {CLASSES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!!picked[c]}
                    onChange={(e) => setPicked({ ...picked, [c]: e.target.checked })}
                    className="accent-ink"
                  />
                  <ClassTag c={c} />
                </label>
              ))}
              <div>
                <Button type="button" onClick={deposit}>
                  Deposit capital
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="Withdraw capital" aside={<span className="mono text-sm">{n0(w.free)} USDC free</span>}>
            <p className="mb-5 text-sm text-slate">Capital backing open coverage cannot leave.</p>
            <ul className="mb-5 grid gap-2 text-sm">
              {[
                [!hasLive, `Coverage it backs has ended.${hasLive ? ` ${n0(w.required)} USDC stays locked.` : ""}`],
                [true, "The claim reporting period has passed (assumption)."],
                [!pending, "Pending claims are settled."],
                [!pending, "Challenge windows have closed."],
              ].map(([ok, text], i) => (
                <li key={i} className="flex gap-3">
                  <i aria-hidden className={`mt-1.5 block size-2 shrink-0 ${ok ? "bg-ink" : "bg-dawn-ink"}`} />
                  {text as string}
                </li>
              ))}
            </ul>
            <div className="grid gap-4">
              <NumberField label="Amount" suffix={<TokenIcon t="USDC" />} value={wd} onChange={setWd} />
              <div>
                <Button type="button" variant="outline" onClick={withdraw}>
                  Withdraw capital
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="Depositors">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Account</th>
                  <th className={`${th} text-right`}>Capital</th>
                  <th className={th}>Classes backed</th>
                </tr>
              </thead>
              <tbody>
                {pool.deposits.map((d) => (
                  <tr key={d.id}>
                    <td className={`${td} mono`}>{d.account}</td>
                    <td className={`${td} mono text-right`}>{n0(d.amount)} USDC</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {d.classes.map((c) => (
                          <ClassTag key={c} c={c} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </article>
  );
}
