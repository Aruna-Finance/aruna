import Link from "next/link";
import type { LiveVault } from "../useLiveVault";

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
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
          No vault is selected. <Link href="/console/create/" className="underline underline-offset-4">Create one</Link>, or open this page with{" "}
          <span className="mono">?vault=&lt;your vault&gt;</span>.
        </p>
      )}
    </article>
  );
}
