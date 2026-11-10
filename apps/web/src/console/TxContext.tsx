"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { TxDialog, type TxRequest } from "./ui/TxDialog";

const Ctx = createContext<{ open: (r: TxRequest) => void }>({ open: () => {} });

/** One confirmation dialog for the whole console, so any screen or tab can ask without rendering its own. */
export function TxProvider({ children }: { children: ReactNode }) {
  const [tx, setTx] = useState<TxRequest | null>(null);
  return (
    <Ctx.Provider value={{ open: setTx }}>
      {children}
      <TxDialog tx={tx} onClose={() => setTx(null)} />
    </Ctx.Provider>
  );
}

export const useTx = () => useContext(Ctx);
