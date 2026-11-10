/** Display helpers. Amounts in the mock are whole USDC; real amounts are U128 in the token's smallest unit. */
export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const block = (b: number) => `#${b.toLocaleString("en-US")}`;
export const dateUtc = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export const days = (sec: number) => `${Math.round(sec / 86_400)} days`;
