"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";

// Wallet login only: connect, show the account, disconnect. Nothing here signs or sends a transaction, and the
// network is testnet (CLAUDE.md rule 3). The connector touches the browser, so it is imported inside an effect and
// never during the static build. API as documented at docs.near.org/web3-apps/tutorials/wallet-login.

type Status = "idle" | "connecting" | "error";
interface WalletState {
  accountId: string | null;
  status: Status;
  error: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const Ctx = createContext<WalletState>({
  accountId: null,
  status: "idle",
  error: null,
  connect: async () => {},
  disconnect: async () => {},
});

/** Closing the wallet modal rejects the promise. That is a cancel, not a failure worth showing: returns null for it. */
export function connectErrorMessage(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!msg) return null;
  return /cancel|clos|reject|abort|denied/i.test(msg) ? null : msg;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};
    (async () => {
      try {
        const { NearConnector } = await import("@hot-labs/near-connect");
        if (cancelled) return;
        const c = new NearConnector({ network: "testnet" });
        connector.current = c;
        const onIn = (p: { accounts: { accountId: string }[] }) => {
          if (!cancelled) setAccountId(p.accounts[0]?.accountId ?? null);
        };
        const onOut = () => {
          if (!cancelled) setAccountId(null);
        };
        c.on("wallet:signIn", onIn);
        c.on("wallet:signOut", onOut);
        detach = () => {
          c.off("wallet:signIn", onIn);
          c.off("wallet:signOut", onOut);
        };
        // A returning visitor may already be connected. No saved wallet is the normal case, not an error.
        try {
          const { accounts } = await c.getConnectedWallet();
          if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
        } catch {
          /* not connected */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The wallet connector could not load.");
      }
    })();
    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  const connect = useCallback(async () => {
    const c = connector.current;
    if (!c) {
      setError("The wallet connector is still loading. Try again in a moment.");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      await c.connect();
      setStatus("idle");
    } catch (e) {
      // Closing the wallet modal rejects; that is a cancel, not a failure worth a banner.
      const msg = connectErrorMessage(e);
      setStatus(msg ? "error" : "idle");
      setError(msg);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await connector.current?.disconnect();
    } finally {
      setAccountId(null);
    }
  }, []);

  return <Ctx.Provider value={{ accountId, status, error, connect, disconnect }}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx);
