"use client";

import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "./chain-reads";

/** The vault's NEAR balance, read from the chain. Reads again when `refreshKey` changes; null while unknown. */
export function useBalance(vault: string, refreshKey: unknown) {
  const reads = useMemo(() => createTestnetReads(), []);
  const [b, setB] = useState<bigint | null>(null);
  useEffect(() => {
    let alive = true;
    reads.balance(vault).then((v) => alive && setB(v)).catch(() => alive && setB(null));
    return () => {
      alive = false;
    };
  }, [reads, vault, refreshKey]);
  return b;
}
