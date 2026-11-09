"use client";
import { useState } from "react";
import { lookup, EXAMPLE_ACCOUNTS } from "@/landing/lib/classifier-adapter";
import type { LookupResult, Network } from "@/landing/lib/classifier-types";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { toast } from "@/shared/Toaster";
import { ClassResult } from "./Evidence";
import { Verify } from "./Verify";

const field = "border border-line-2 bg-white px-3 py-3.5";

export function CheckBox() {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState<Network>("testnet");
  const [res, setRes] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(id: string) {
    if (!id.trim()) return;
    setBusy(true);
    try {
      const r = await lookup(id, network);
      setRes(r);
      if (r.ok) toast.success(`Classified ${r.classification.evidence.accountId}`, { description: r.classification.class });
      else toast.error("Could not classify", { description: r.reason });
    } catch (e) {
      toast.error("Lookup failed", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 w-full border border-line-2 bg-white p-6 md:p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(account);
        }}
      >
        <label htmlFor="acct" className="mb-1.5 block text-[13px] text-muted">
          NEAR account
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="acct"
            className={`${field} mono min-w-[220px] flex-1`}
            value={account}
            autoComplete="off"
            spellCheck={false}
            placeholder="router.testnet"
            onChange={(e) => setAccount(e.target.value)}
          />
          <Select
            label="Network"
            value={network}
            onValueChange={setNetwork}
            options={[
              { value: "testnet", label: "testnet" },
              { value: "mainnet", label: "mainnet (read-only)" },
            ]}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Checking..." : "Classify"}
          </Button>
        </div>
      </form>
      <div className="mt-4">
        <p className="mb-2 text-[13px] text-muted">Examples</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_ACCOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              className="label cursor-pointer border border-line-2 px-3 py-2.5 text-sm normal-case transition-colors hover:border-ink"
              onClick={() => {
                setAccount(a);
                void run(a);
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite">
        {res?.ok === false && (
          <p className="mt-3 max-w-[62ch] bg-dawn-wash px-3 py-2 text-sm">{res.reason}</p>
        )}
        {res?.ok && (
          <>
            {res.source === "stub" && (
              <p className="mono mt-3 text-xs font-medium text-dawn-ink">Stub data. Not a live chain read.</p>
            )}
            <ClassResult c={res.classification} />
            <Verify accountId={res.classification.evidence.accountId} network={network} />
          </>
        )}
      </div>
    </div>
  );
}
