import Link from "next/link";
import { WithPlus } from "@/shared/WithPlus";
import type { LiveVault } from "../useLiveVault";
import { useOperatedVaults } from "../useOperatedVaults";
import { useOwnedVaults } from "../useOwnedVaults";
import { useWallet } from "../WalletContext";
import { Button } from "@/shared/Button";
import { PageHeader } from "./PageHeader";

/** With a wallet connected, the vaults it owns, so a vault is one click away even when the browser forgot it. */
function OwnedChoice() {
  const { accountId } = useWallet();
  const owned = useOwnedVaults(accountId ?? null);
  const operated = useOperatedVaults(accountId ?? null);
  const operatedList = operated.state === "ok" ? operated.list.filter((o) => !(owned.state === "ok" && owned.list.some((v) => v.vault === o.vault))) : [];
  if (owned.state === "none") return <ConnectFirst />;
  if (owned.state === "loading") return <p className="mt-4 text-sm text-muted">Looking for your vaults.</p>;
  if (owned.state === "error") return <p className="mt-4 text-sm text-dawn-ink">Couldn&apos;t look up your vaults. Try again in a moment.</p>;
  if (owned.list.length === 0 && operatedList.length === 0)
    return (
      <div className="mt-4">
        <p className="max-w-[70ch] text-[15px]">
          <span className="mono">{accountId}</span> has no vault yet.
        </p>
        <Link href="/console/create/" tabIndex={-1} className="mt-5 inline-block">
          <Button type="button"><WithPlus>Create a vault</WithPlus></Button>
        </Link>
      </div>
    );
  return (
    <>
    <p className="mt-4 text-[15px]">Choose a vault.</p>
    <ul className="mt-3 grid gap-2">
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
    <p className="mt-5 text-sm text-muted">
      Or <Link href="/console/create/" className="underline underline-offset-4">create a new vault</Link>.
    </p>
    </>
  );
}

/** No wallet yet: connecting is the first action, creating a vault the second, reading someone else's the third. */
function ConnectFirst() {
  const { connect, status } = useWallet();
  return (
    <div className="mt-4">
      <p className="max-w-[70ch] text-[15px] leading-[1.6] text-slate">Connect your wallet to see your vaults.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="button" disabled={status === "connecting"} onClick={() => void connect()}>
          {status === "connecting" ? "Connecting" : "Connect wallet"}
        </Button>
        <Link href="/console/create/" className="text-[15px] underline underline-offset-4">
          New here? Create a vault
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted">
        To read someone else&apos;s vault without a wallet, use{" "}
        <Link href="/console/lookup/" className="underline underline-offset-4">
          Check an agent
        </Link>
        .
      </p>
    </div>
  );
}

/** Shown where a screen needs a vault and has none to read: nothing is invented in its place. */
export function NoVault({ live, title }: { live: Exclude<LiveVault, { status: "ok" }>; title: string }) {
  return (
    <article>
      <PageHeader title={title} />
      {live.status === "loading" && <p className="mt-4 text-muted">Reading the vault.</p>}
      {live.status === "error" && (
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
          Couldn&apos;t read <span className="mono break-all">{live.vault}</span>. Check the vault name, or try again in a moment.
        </p>
      )}
      {live.status === "none" && (
        <>
          <OwnedChoice />
        </>
      )}
    </article>
  );
}
