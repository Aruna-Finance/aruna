// A fungible token's amount in its own units. Integer arithmetic only: the amount is a string in the smallest unit and the
// decimals come from the token contract's own `ft_metadata`, never a guess.

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

/** "10000000" with 6 decimals is "10"; "27732" is "0.027732". No rounding: every digit the token has is shown. */
export function formatUnits(amount: string, decimals: number): string {
  let v: bigint;
  try {
    v = BigInt(amount);
  } catch {
    return amount;
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return amount;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/**
 * "12.5" with 6 decimals is 12500000n. Digits with at most one point only: a sign, an exponent, a thousands separator, a
 * trailing point or more fraction digits than the token has gives null, so a typed amount is never rounded or guessed.
 */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  return BigInt((whole || "0") + frac.padEnd(decimals, "0"));
}

/** Reads `ft_metadata` into what the screens need, or null when the contract answered something else. */
export function metaOf(raw: unknown): TokenMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { symbol?: unknown; decimals?: unknown };
  if (typeof r.symbol !== "string" || r.symbol === "" || typeof r.decimals !== "number" || !Number.isInteger(r.decimals)) return null;
  return { symbol: r.symbol, decimals: r.decimals };
}
