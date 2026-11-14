"use client";

import type { ReactNode } from "react";
import { useWallet } from "../WalletContext";
import { RELATION_TEXT, type Relation } from "../walletRole";

/**
 * A vault drawn as nested frames, each turned a little further, around one core.
 * Pure SVG and Tailwind, no dependency. It is decoration, so it is hidden from assistive tech.
 */
function VaultGraphic() {
  const frame = "origin-center [transform-box:fill-box]";
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" className="size-full">
      <g fill="none" strokeWidth="0.75">
        <rect x="20" y="20" width="160" height="160" className={`${frame} stroke-line-2`} />
        <rect x="34" y="34" width="132" height="132" className={`${frame} rotate-[15deg] stroke-line-2`} />
        <rect x="46" y="46" width="108" height="108" className={`${frame} rotate-[30deg] stroke-line-2`} />
        <rect x="58" y="58" width="84" height="84" className={`${frame} rotate-[45deg] stroke-dawn/50`} />
      </g>
      <rect x="88" y="88" width="24" height="24" className="fill-dawn-wash stroke-dawn/60" strokeWidth="0.75" />
    </svg>
  );
}

/** Says who the connected wallet is, on every screen. Orange when a wallet is connected, grey when none is. */
function WalletNotice({ relation, extra }: { relation?: Relation | null; extra?: string | false }) {
  const { accountId } = useWallet();
  const vaultScreen = relation !== undefined;
  const text = !accountId
    ? vaultScreen
      ? "No wallet connected. Connect one to act on this vault as its owner or operator. You can read everything here without a wallet."
      : "No wallet connected. Connect one to act as the owner or operator of a vault. You can read everything here without a wallet."
    : vaultScreen && relation
      ? `${RELATION_TEXT[relation]}${extra ? ` ${extra}` : ""}`
      : `Connected as ${accountId}. Open a vault from the Vault menu to see what this account may do on it.`;
  const tone = "border-dawn text-dawn";
  return <p className={`mt-5 max-w-[70ch] border px-4 py-2 text-[15px] leading-[1.6] ${tone}`}>{text}</p>;
}

/** The top of a console screen: title, one plain sentence, the screen's buttons, and the graphic. */
export function PageHeader({
  title,
  lead,
  actions,
  relation,
  extra,
  children,
}: {
  title: ReactNode;
  /** A small line above the title, such as a way back. */
  lead?: ReactNode;
  actions?: ReactNode;
  /** On a vault screen: who the connected wallet is to this vault (null when no wallet). Leave out on other screens. */
  relation?: Relation | null;
  /** More to say after the relation, such as that the owner is viewing as the operator. */
  extra?: string | false;
  /** The sentence under the title. */
  children?: ReactNode;
}) {
  return (
    <header className="relative flex min-h-56 items-center overflow-hidden border border-line-2 bg-paper p-6 md:p-8">
      <div className="relative w-full min-w-0 md:pr-48 lg:pr-64">
        {lead && <div className="mb-3 text-sm">{lead}</div>}
        <h1 className="break-words text-[clamp(28px,4vw,44px)]">{title}</h1>
        {children && <div className="mt-4 max-w-[70ch] font-[family-name:var(--font-label)] leading-[1.6] text-slate">{children}</div>}
        <WalletNotice relation={relation} extra={extra} />
        {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      <div className="pointer-events-none absolute -right-10 top-1/2 hidden size-80 -translate-y-1/2 md:block lg:-right-8 lg:size-96">
        <VaultGraphic />
      </div>
    </header>
  );
}
