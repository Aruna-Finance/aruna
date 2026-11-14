"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowsLeftRight, Check } from "@phosphor-icons/react";
import { Button } from "@/shared/Button";
import { switchHref, switchOptions, type SwitchOption } from "../data/vault-switch";
import { useOperatedVaults } from "../useOperatedVaults";
import { useOwnedVaults } from "../useOwnedVaults";
import { useWallet } from "../WalletContext";

/** The current vault, and a Switch vault button that says how many vaults the account has. With only one, it says so instead. */
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
  const mono = <span className="mono block break-all text-xs text-muted">{vault}</span>;
  if (options.length < 2) {
    return (
      <div>
        {mono}
        <p className="mt-3 text-xs text-muted">Your only vault. Add more from the Vault menu and they will switch from here.</p>
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      {mono}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">You have {options.length} vaults</span>
        <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="inline-flex items-center gap-2">
            <ArrowsLeftRight size={16} weight="regular" aria-hidden />
            Switch vault
          </span>
        </Button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[85vw] border border-ink bg-paper">
          <p className="border-b border-line px-3 py-2 text-xs text-muted">Pick the vault to show on this screen</p>
          <ul role="listbox" aria-label="Switch vault" className="max-h-64 overflow-auto">
            {options.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === vault}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onPick(o.value); }}
                  className={`mono flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-xs hover:bg-dawn ${o.value === vault ? "bg-wash" : ""}`}
                >
                  <span className="break-all">{o.label}</span>
                  {o.value === vault ? (
                    <span className="inline-flex shrink-0 items-center gap-1 font-sans text-muted">
                      showing <Check size={14} weight="regular" aria-hidden />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
