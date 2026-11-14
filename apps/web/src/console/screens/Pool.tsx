"use client";

import { ReadError } from "@/shared/ReadError";
import { Button } from "@/shared/Button";
import { useId, useMemo, useState } from "react";
import { amountText } from "../data/coverage-live";
import {
  BOOK_TOKENS,
  bookFigures,
  bpsText,
  checkDeposit,
  checkWithdraw,
  depositBlock,
  groupRows,
  payoutFor,
  stageCounts,
  withdrawBlock,
  type BookFigures,
  type GroupBy,
  type WalletToken,
} from "../data/pool-live";
import type { TokenMeta } from "../data/token-amount";
import { depositReview, withdrawReview } from "../data/underwriter-review";
import { usePoolLive, useWalletTokens, type PoolLive } from "../usePoolLive";
import { useTokenMeta } from "../useTokenMeta";
import { NO_ACTIONS, useUnderwriterActions, type UnderwriterActions } from "../useUnderwriterActions";
import { useWallet } from "../WalletContext";
import { Panel } from "../ui/Panel";
import { PageHeader } from "../ui/PageHeader";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

const BY: { id: GroupBy; label: string }[] = [
  { id: "code_hash", label: "Same code" },
  { id: "upgrade_authority", label: "Same upgrader" },
];

export function Pool() {
  const { accountId } = useWallet();
  const [refresh, setRefresh] = useState(0);
  const data = usePoolLive(accountId ?? null, refresh);
  const wallet = useWalletTokens(accountId ?? null, refresh);
  const actions = useUnderwriterActions(() => setRefresh((n) => n + 1));
  return <PoolView data={data} account={accountId ?? null} wallet={wallet} actions={actions} />;
}

type Meta = ReadonlyMap<string, TokenMeta>;

/** `wallet`, `actions` and `meta` are inputs only so the screen can be rendered in a test; the screen itself reads and acts through the hooks above. */
export function PoolView({ data, account, wallet = new Map(), actions = NO_ACTIONS, meta: given }: { data: PoolLive; account: string | null; wallet?: ReadonlyMap<string, WalletToken>; actions?: UnderwriterActions; meta?: Meta }) {
  const tokens = data.state === "ok" ? [...BOOK_TOKENS] : [];
  const fetched = useTokenMeta(tokens);
  const meta = given ?? fetched;
  return (
    <article>
      <PageHeader title="Pool">
        Capital in the pool and the coverage it backs. Underwriters add capital to a book and take it out once the book&apos;s lock ends.
      </PageHeader>
      {data.state === "loading" && <p className="mt-6 text-muted">Reading the pool.</p>}
      {data.state === "error" && <ReadError what="the pool" detail={data.message} className="mt-6" />}
      {data.state === "ok" && (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          {tokens.map((t) => (
            <TokenBook key={t} token={t} data={data} account={account} meta={meta} wallet={wallet.get(t)} actions={actions} />
          ))}
        </div>
      )}
    </article>
  );
}

function TokenBook({
  token,
  data,
  account,
  meta,
  wallet,
  actions,
}: {
  token: string;
  data: Extract<PoolLive, { state: "ok" }>;
  account: string | null;
  meta: Meta;
  wallet: WalletToken | undefined;
  actions: UnderwriterActions;
}) {
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
    ["Withdrawals", f.locked ? "Locked" : "Open", f.locked ? `for ${f.blocksToUnlock.toLocaleString("en-US")} more blocks` : "Capital can be withdrawn"],
    ["Coverage", `${counts.active} active`, `${counts.ended} ended and not yet released, ${counts.paid} paid, ${counts.claimInFlight} in a claim, ${counts.released} released`],
  ];

  return (
    <Panel title={`${label} book`}>
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

      {account ? (
        <UnderwriterPanel token={token} label={label} f={f} head={data.head} mine={mine} wallet={wallet} meta={meta.get(token)} actions={actions} />
      ) : (
        <p className="mt-6 text-sm text-muted">Connect a wallet to deposit or withdraw.</p>
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

const inputClass = "mono mt-1.5 block w-full border border-line-2 bg-paper px-3 py-3.5 text-sm outline-none transition-colors hover:border-ink focus:border-ink disabled:opacity-60";

/**
 * The underwriter's own actions on one book. Every figure the forms show is an estimate read from the contract; the dialog says
 * so, and the pool decides. A form that cannot be used says why in words beside it, and never opens a dialog.
 */
function UnderwriterPanel({
  token,
  label,
  f,
  head,
  mine,
  wallet,
  meta,
  actions,
}: {
  token: string;
  label: string;
  f: BookFigures;
  head: number;
  mine: string | undefined;
  wallet: WalletToken | undefined;
  meta: TokenMeta | undefined;
  actions: UnderwriterActions;
}) {
  // A token's units come from its own metadata. Until they are read, a typed amount cannot be turned into an exact number.
  const decimals = token === "near" ? 24 : meta?.decimals;
  const fmt = (v: bigint) => amountText(token, v.toString(), meta);
  const common = { token, label, f, head, wallet, decimals, fmt, actions };
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <DepositForm {...common} />
      <WithdrawForm {...common} held={BigInt(mine ?? "0")} />
    </div>
  );
}

interface FormProps {
  token: string;
  label: string;
  f: BookFigures;
  head: number;
  wallet: WalletToken | undefined;
  decimals: number | undefined;
  fmt: (v: bigint) => string;
  actions: UnderwriterActions;
}

function DepositForm({ token, label, f, head, wallet, decimals, fmt, actions }: FormProps) {
  const [text, setText] = useState("");
  const inputId = useId();
  const reasonId = useId();
  const blocked = decimals === undefined ? `Checking the units of ${label}.` : depositBlock(f, token, label, wallet);
  const check = !blocked && decimals !== undefined && text.trim() !== "" && wallet?.state === "ok" ? checkDeposit(text, decimals, f, wallet.balance, fmt) : null;
  const reason = blocked ?? (check && !check.ok ? check.reason : null);
  const ready = check?.ok === true;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (check?.ok) actions.deposit({ token, label, amount: check.amount, review: depositReview({ label, amountText: fmt(check.amount), check, f, head }) });
      }}
    >
      <h3 className="text-base font-medium">Deposit {label}</h3>
      <label htmlFor={inputId} className="mt-3 block text-sm font-medium">
        Amount in {label}
      </label>
      <input id={inputId} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={text} disabled={!!blocked} aria-describedby={reason ? reasonId : undefined} onChange={(e) => setText(e.target.value)} className={inputClass} />
      {wallet?.state === "ok" && <p className="mt-1.5 text-sm text-muted">Your wallet holds {fmt(wallet.balance)}.</p>}
      {reason && (
        <p id={reasonId} className="mt-3 text-sm leading-[1.6] text-dawn-ink" role="status">
          {reason}
        </p>
      )}
      <Button type="submit" variant="outline" className="mt-4" disabled={!ready} aria-describedby={reason ? reasonId : undefined}>
        Review deposit
      </Button>
    </form>
  );
}

function WithdrawForm({ token, label, f, head, wallet, decimals, fmt, actions, held }: FormProps & { held: bigint }) {
  const [text, setText] = useState("");
  const inputId = useId();
  const reasonId = useId();
  if (held === 0n) {
    return (
      <div>
        <h3 className="text-base font-medium">Withdraw {label}</h3>
        <p className="mt-3 text-sm text-muted">You have no position in this book.</p>
      </div>
    );
  }
  const blocked = decimals === undefined ? `Checking the units of ${label}.` : withdrawBlock(f, held, token, label, wallet);
  const all = !blocked && decimals !== undefined ? checkWithdraw({ all: true }, decimals, f, held, fmt) : null;
  const check = !blocked && decimals !== undefined && text.trim() !== "" ? checkWithdraw({ text }, decimals, f, held, fmt) : null;
  const reason = blocked ?? (check && !check.ok ? check.reason : null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (check?.ok) actions.withdraw({ token, label, plan: { shares: check.shares }, review: withdrawReview({ label, receivesText: fmt(check.receives), all: false, f, head }) });
      }}
    >
      <h3 className="text-base font-medium">Withdraw {label}</h3>
      <p className="mt-3 text-sm text-slate">Your position is worth {fmt(payoutFor(held, f.capital, f.totalShares))}.</p>
      <label htmlFor={inputId} className="mt-3 block text-sm font-medium">
        Amount in {label}
      </label>
      <input id={inputId} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={text} disabled={!!blocked} aria-describedby={reason ? reasonId : undefined} onChange={(e) => setText(e.target.value)} className={inputClass} />
      {reason && (
        <p id={reasonId} className="mt-3 text-sm leading-[1.6] text-dawn-ink" role="status">
          {reason}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" variant="outline" disabled={check?.ok !== true} aria-describedby={reason ? reasonId : undefined}>
          Review withdrawal
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={all?.ok !== true}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => {
            if (all?.ok) actions.withdraw({ token, label, plan: { all: true }, review: withdrawReview({ label, receivesText: fmt(all.receives), all: true, f, head }) });
          }}
        >
          Withdraw everything
        </Button>
      </div>
    </form>
  );
}

/** A holder's shares as a percentage of the book, never the raw share count. */
export function shareText(mine: string | undefined, total: bigint): string {
  if (!mine || mine === "0" || total === 0n) return "0%";
  const bp = (BigInt(mine) * 10000n) / total;
  return `${(Number(bp) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
