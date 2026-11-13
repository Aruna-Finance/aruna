import Link from "next/link";
import type { LiveVault } from "../useLiveVault";
import { useOperatedVaults } from "../useOperatedVaults";
import { useOwnedVaults } from "../useOwnedVaults";
import { useWallet } from "../WalletContext";

/** With a wallet connected, the vaults it owns, so a vault is one click away even when the browser forgot it. */
function OwnedChoice() {
  const { accountId } = useWallet();
  const owned = useOwnedVaults(accountId ?? null);
  const operated = useOperatedVaults(accountId ?? null);
  const operatedList = operated.state === "ok" ? operated.list.filter((o) => !(owned.state === "ok" && owned.list.some((v) => v.vault === o.vault))) : [];
  if (owned.state === "none") return <p className="mt-4 max-w-[70ch] text-sm text-muted">Connect a wallet to see the vaults it owns.</p>;
  if (owned.state === "loading") return <p className="mt-4 text-sm text-muted">Looking for the vaults {accountId} owns.</p>;
  if (owned.state === "error") return <p className="mt-4 text-sm text-dawn-ink">Could not look up your vaults. {owned.message}</p>;
  if (owned.list.length === 0 && operatedList.length === 0) return <p className="mt-4 text-sm text-muted">{accountId} owns or operates no vault yet.</p>;
  return (
    <ul className="mt-4 grid gap-2">
      {owned.list.map((v) => (
        <li key={v.vault} className="flex flex-wrap items-center gap-3 text-[15px]">
          <a href={`?vault=${encodeURIComponent(v.vault)}`} className="mono underline underline-offset-4">
            {v.vault}
          </a>
          <span className="text-sm text-muted">{v.version}</span>
        </li>
      ))}
      {operatedList.map((v) => (
        <li key={v.vault} className="flex flex-wrap items-center gap-3 text-[15px]">
          <a href={`?vault=${encodeURIComponent(v.vault)}`} className="mono underline underline-offset-4">
            {v.vault}
          </a>
          <span className="text-sm text-muted">operator</span>
        </li>
      ))}
    </ul>
  );
}

/** Shown where a screen needs a vault and has none to read: nothing is invented in its place. */
export function NoVault({ live, title }: { live: Exclude<LiveVault, { status: "ok" }>; title: string }) {
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">{title}</h1>
      {live.status === "loading" && <p className="mt-4 text-muted">Reading the vault.</p>}
      {live.status === "error" && (
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
          Could not read <span className="mono break-all">{live.vault}</span>. {live.message}
        </p>
      )}
      {live.status === "none" && (
        <>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            No vault is selected. <Link href="/console/create/" className="underline underline-offset-4">Create one</Link>, or open this page with{" "}
            <span className="mono">?vault=&lt;your vault&gt;</span>.
          </p>
          <OwnedChoice />
        </>
      )}
    </article>
  );
}
