// Small statistics, no dependencies.
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Wilson score interval for a proportion, 95%. */
export function wilson(successes: number, n: number): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const z = 1.959964;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
}

/** Round for printing into result files, so they are stable and readable. */
export const r = (x: number, digits = 4): number => (Number.isFinite(x) ? Number(x.toFixed(digits)) : x);
