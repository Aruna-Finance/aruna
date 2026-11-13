"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "@phosphor-icons/react";
import { switchHref, switchOptions, type SwitchOption } from "../data/vault-switch";
import { useOperatedVaults } from "../useOperatedVaults";
import { useOwnedVaults } from "../useOwnedVaults";
import { useWallet } from "../WalletContext";

/** The current vault as plain text, with a Switch vault button on the right when the account has other vaults. */
export function VaultSwitch({ vault }: { vault: string }) {
  const { accountId } = useWallet();
  const owned = useOwnedVaults(accountId ?? null);
  const operated = useOperatedVaults(accountId ?? null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  return (
    <VaultSwitchView
      vault={vault}
      options={switchOptions(vault, [...(owned.state === "ok" ? owned.list : []), ...(operated.state === "ok" ? operated.list : [])])}
      onPick={(v) => router.push(switchHref(pathname, search ? `?${search}` : "", v))}
    />
  );
}

export function VaultSwitchView({ vault, options, onPick, startOpen = false }: { vault: string; options: SwitchOption[]; onPick: (v: string) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (options.length < 2) return <span className="mono block break-all text-xs text-muted">{vault}</span>;
  return (
    <div ref={box} className="relative flex items-start justify-between gap-3">
      <span className="mono min-w-0 break-all text-xs text-muted">{vault}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="shrink-0 cursor-pointer text-xs underline underline-offset-4">
        Switch vault
      </button>
      {open && (
        <ul role="listbox" aria-label="Switch vault" className="absolute right-0 top-full z-50 mt-2 max-h-64 w-72 max-w-[80vw] overflow-auto border border-ink bg-white">
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === vault}>
              <button
                type="button"
                onClick={() => { setOpen(false); onPick(o.value); }}
                className={`mono flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-xs hover:bg-dawn ${o.value === vault ? "bg-wash" : ""}`}
              >
                <span className="break-all">{o.label}</span>
                {o.value === vault && <Check size={14} weight="regular" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
