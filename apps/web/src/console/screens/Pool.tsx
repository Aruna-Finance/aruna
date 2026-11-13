"use client";

import { ReadError } from "@/shared/ReadError";
import { useMemo, useState } from "react";
import { amountText } from "../data/coverage-live";
import { bookFigures, bpsText, groupRows, stageCounts, tokensOf, type BookFigures, type GroupBy } from "../data/pool-live";
import { block } from "../fmt";
import { usePoolLive, type PoolLive } from "../usePoolLive";
import { useTokenMeta } from "../useTokenMeta";
import { useWallet } from "../WalletContext";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

const BY: { id: GroupBy; label: string }[] = [
  { id: "code_hash", label: "Same code" },
  { id: "upgrade_authority", label: "Same upgrader" },
];

export function Pool() {
  const { accountId } = useWallet();
  const data = usePoolLive(accountId ?? null);
  return <PoolView data={data} account={accountId ?? null} />;
}

export function PoolView({ data, account }: { data: PoolLive; account: string | null }) {
  const tokens = data.state === "ok" ? tokensOf(data.coverages) : [];
  const meta = useTokenMeta(tokens);
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Pool</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Capital in the pool and the coverage it backs. Deposits and withdrawals aren&apos;t in the console yet.
      </p>
      {data.state === "loading" && <p className="mt-6 text-muted">Reading the pool.</p>}
      {data.state === "error" && <ReadError what="the pool" detail={data.message} className="mt-6" />}
      {data.state === "ok" && (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          {tokens.map((t) => (
            <TokenBook key={t} token={t} data={data} account={account} meta={meta} />
          ))}
        </div>
      )}
    </article>
  );
}

function TokenBook({ token, data, account, meta }: { token: string; data: Extract<PoolLive, { state: "ok" }>; account: string | null; meta: ReturnType<typeof useTokenMeta> }) {
  const [by, setBy] = useState<GroupBy>("code_hash");
  const book = data.books.get(token)!;
  const f: BookFigures = useMemo(() => bookFigures(token, book, data.head), [token, book, data.head]);
  const rows = useMemo(() => groupRows(data.coverages, by, token, f.groupCap), [data.coverages, by, token, f.groupCap]);
  const counts = stageCounts(data.coverages, token, data.head);
  const mine = data.shares.get(token);
  const amt = (v: bigint) => amountText(token, v.toString(), meta.get(token));
  const label = token === "near" ? "NEAR" : meta.get(token)?.symbol ?? token;

  const tiles: [string, string, string?][] = [
    ["Capital", amt(f.capital)],
    ["Coverage outstanding", amt(f.totalLimits), `up to ${amt(f.maxLimits)} allowed by capital; room for ${amt(f.headroom)} more`],
    ["Withdrawals", f.locked ? "Locked" : "Open", f.locked ? `until block ${block(f.lockedUntil)}, ${f.blocksToUnlock.toLocaleString("en-US")} blocks from now` : `lock ended at block ${block(f.lockedUntil)}`],
    ["Coverage", `${counts.active} active`, `${counts.ended} ended and not yet released, ${counts.paid} paid, ${counts.claimInFlight} in a claim, ${counts.released} released`],
  ];

  return (
    <Panel title={`${label} book`} aside={<span className="text-sm text-muted">Read at block {block(data.head)}</span>}>
      <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="bg-paper p-5">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="mono mt-2 break-words text-lg leading-tight">{v}</dd>
            {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
          </div>
        ))}
      </dl>
      {account && (
        <p className="mt-4 text-sm text-slate">
          Your share of this book: <span className="mono">{shareText(mine, f.totalShares)}</span>.
        </p>
      )}

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium">Coverage that one code change could hit, against a cap of {amt(f.groupCap)} each</h3>
          <div className="flex flex-wrap gap-px border border-line-2 bg-line-2" role="group" aria-label="Group by">
            {BY.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={by === o.id}
                onClick={() => setBy(o.id)}
                className={`label cursor-pointer px-3 py-2 text-xs ${by === o.id ? "bg-ink text-paper" : "bg-paper"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No coverage is on this book.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>{by === "code_hash" ? "Code version" : "Who can upgrade it"}</th>
                  <th className={`${th} text-right`}>Coverage</th>
                  <th className={`${th} text-right`}>Of the cap</th>
                  <th className={th}>Contracts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className={`${td} mono break-all text-sm`}>{r.key}</td>
                    <td className={`${td} mono text-right`}>{amt(r.limit)}</td>
                    <td className={`${td} mono text-right ${r.usedBps > 10_000 ? "text-dawn-ink" : ""}`}>{bpsText(r.usedBps)}</td>
                    <td className={`${td} mono text-sm`}>
                      {r.targets.join(", ")}
                      <span className="block text-xs text-muted">
                        {r.coverages} {r.coverages === 1 ? "coverage" : "coverages"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-muted">
          Coverage is what each policy can still pay. The pool refuses a purchase that would take one group over its cap, or the total over what
          capital allows.
        </p>
      </div>
    </Panel>
  );
}

/** A holder's shares as a percentage of the book, never the raw share count. */
export function shareText(mine: string | undefined, total: bigint): string {
  if (!mine || mine === "0" || total === 0n) return "0%";
  const bp = (BigInt(mine) * 10000n) / total;
  return `${(Number(bp) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
