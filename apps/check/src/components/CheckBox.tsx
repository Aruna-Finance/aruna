"use client";
import { useState } from "react";
import { lookup, EXAMPLE_ACCOUNTS } from "@/lib/classifier-adapter";
import type { LookupResult, Network } from "@/lib/classifier-types";
import { ClassResult } from "./Evidence";
import { Verify } from "./Verify";

export function CheckBox() {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState<Network>("testnet");
  const [res, setRes] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(id: string) {
    if (!id.trim()) return;
    setBusy(true);
    setRes(await lookup(id, network));
    setBusy(false);
  }

  return (
    <div className="chk-box">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(account);
        }}
      >
        <label htmlFor="acct">NEAR account</label>
        <div className="row">
          <input
            id="acct"
            className="mono"
            value={account}
            autoComplete="off"
            spellCheck={false}
            placeholder="router.testnet"
            onChange={(e) => setAccount(e.target.value)}
          />
          <select
            aria-label="Network"
            value={network}
            onChange={(e) => setNetwork(e.target.value as Network)}
          >
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet (read-only)</option>
          </select>
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Classify"}
          </button>
        </div>
      </form>
      <p className="ex">
        Examples:{" "}
        {EXAMPLE_ACCOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            className="link mono"
            onClick={() => {
              setAccount(a);
              void run(a);
            }}
          >
            {a}
          </button>
        ))}
      </p>
      <div aria-live="polite">
        {res?.ok === false && <p className="note">{res.reason}</p>}
        {res?.ok && (
          <>
            {res.source === "stub" && <p className="stub">Stub data. Not a live chain read.</p>}
            <ClassResult c={res.classification} />
            <Verify accountId={res.classification.evidence.accountId} network={network} />
          </>
        )}
      </div>
    </div>
  );
}
