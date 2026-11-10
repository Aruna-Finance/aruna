/** Display helpers. Amounts in the mock are whole USDC; real amounts are U128 in the token's smallest unit. */
export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const block = (b: number) => `#${b.toLocaleString("en-US")}`;
export const dateUtc = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export const days = (sec: number) => `${Math.round(sec / 86_400)} days`;

const YOCTO = 10n ** 24n;
/** A yoctoNEAR string as NEAR with up to four decimals, using integers only. Never a float. */
export function yoctoToNear(yocto: string): string {
  let v: bigint;
  try {
    v = BigInt(yocto);
  } catch {
    return yocto;
  }
  const whole = v / YOCTO;
  const frac = ((v % YOCTO) * 10_000n) / YOCTO;
  const f = frac.toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}
