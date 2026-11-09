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
  // The network the shown result was read from; the selector may have changed since.
  const [res, setRes] = useState<{ r: LookupResult; network: Network } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(id: string, net: Network = network) {
    if (!id.trim()) return;
    setBusy(true);
    try {
      const r = await lookup(id, net);
      setRes({ r, network: net });
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
        <p className="mb-2 text-[13px] text-muted">Examples (testnet, one per class)</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_ACCOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              className="label cursor-pointer border border-line-2 px-3 py-2.5 text-sm normal-case transition-colors hover:border-ink"
              onClick={() => {
                // The examples are testnet accounts: read them there whatever the selector shows.
                setAccount(a);
                setNetwork("testnet");
                void run(a, "testnet");
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite">
        {res?.r.ok === false && (
          <p className="mt-3 max-w-[62ch] bg-dawn-wash px-3 py-2 text-sm">{res.r.reason}</p>
        )}
        {res?.r.ok && (
          <>
            <p className="mono mt-3 text-xs text-muted">
              Live read from public {res.network} RPC at block {res.r.classification.evidence.checkedAtBlock}.
            </p>
            <ClassResult c={res.r.classification} />
            <Verify accountId={res.r.classification.evidence.accountId} network={res.network} />
          </>
        )}
      </div>
    </div>
  );
}
