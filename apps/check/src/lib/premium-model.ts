// MOCK pricing model for the landing page dial. It mirrors the prototype's ASSUME table and the premium
// formula in docs/CONTRACTS.md: Premium = ExpectedLoss + CapitalCost + OperationalCost + RiskMargin.
// Every number in ASSUME is an underwriting assumption owned by the contract team, not a measurement.
// Replace this file with the SDK's simulate() once it exists. All money is integer micro-USDC.
export type PricedClass = "immutable_verified" | "local_upgradeable" | "global_by_account" | "unknown";

const USDC = 1_000_000;

export const ASSUME = {
  /** probability of an implementation change in 30 days */
  pEvent30d: { immutable_verified: 0, local_upgradeable: 0.015, global_by_account: 0.03 },
  capitalCostAnnual: 0.06,
  capitalWeight: { immutable_verified: 0.1, local_upgradeable: 1, global_by_account: 1.4 },
  opsCostPerDay: 0.1 * USDC,
  riskMarginOfEL: 0.15,
  slippageLoadPerPct: 0.8,
  payoutBps: 8000,
  utilization: 0.35,
  days: 30,
} as const;

export type Premium =
  | { priced: false; maxExposure: number }
  | { priced: true; maxExposure: number; total: number; pctOfExposure: number };

/** dailyCap in whole USDC, slippagePct as a percent (0.5 = 0.5%). Returns amounts in whole USDC. */
export function premium(cls: PricedClass, dailyCapUsdc: number, slippagePct: number): Premium {
  const maxExposure = dailyCapUsdc * ASSUME.days;
  if (cls === "unknown") return { priced: false, maxExposure };
  const limit = maxExposure * USDC;
  const ratio = ASSUME.payoutBps / 10000;
  const slippageLoad = 1 + ASSUME.slippageLoadPerPct * slippagePct;
  const expectedLoss = Math.round(ASSUME.pEvent30d[cls] * limit * ratio * slippageLoad);
  const capitalCost = Math.round(
    limit * ASSUME.capitalCostAnnual * (ASSUME.days / 365) * ASSUME.capitalWeight[cls] * (1 + ASSUME.utilization * 0.5),
  );
  const opsCost = ASSUME.opsCostPerDay * ASSUME.days;
  const riskMargin = Math.round(expectedLoss * ASSUME.riskMarginOfEL);
  const total = expectedLoss + capitalCost + opsCost + riskMargin;
  return { priced: true, maxExposure, total: total / USDC, pctOfExposure: (total / limit) * 100 };
}
