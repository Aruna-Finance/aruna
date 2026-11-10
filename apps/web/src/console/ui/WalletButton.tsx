"use client";
import { useWallet } from "../WalletContext";

const btn =
  "label shrink-0 cursor-pointer border border-ink px-3 py-2 text-[13px] transition-colors hover:bg-ink hover:text-paper disabled:cursor-progress disabled:opacity-60";

/** Connect or disconnect a testnet wallet. Login only: no screen signs a transaction yet. */
export function WalletButton() {
  const { accountId, status, error, connect, disconnect } = useWallet();

  if (accountId) {
    return (
      <div className="flex items-center gap-2">
        <span className="mono max-w-[9ch] truncate text-[13px] sm:max-w-[28ch]" title={`Connected wallet: ${accountId}`}>
          {accountId}
        </span>
        <button type="button" className={btn} onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="max-w-[24ch] truncate text-xs text-dawn-ink" title={error}>
          {error}
        </span>
      )}
      <button type="button" className={btn} disabled={status === "connecting"} onClick={() => void connect()}>
        {status === "connecting" ? "Connecting" : "Connect wallet"}
      </button>
    </div>
  );
}
