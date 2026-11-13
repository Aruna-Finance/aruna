// @aruna/sdk/coverage — the coverage half of the SDK: registry and pool reads (keyless), the quote,
// and the owner's purchase and claim. Kept apart from the keyless root entry like @aruna/sdk/vault.
export { fetchViewTransport } from "./transport.js";
export type { ReadTransport } from "./transport.js";
export { classRecordArgs, isNoRiskier, RISK_ORDER } from "./class-record.js";
export type { SetClassArgs } from "./class-record.js";
export { Registry } from "./registry.js";
export type { ClassRecord, DriftReport, RegisteredVault, VaultPage } from "./registry.js";
export { Pool, tokenId } from "./pool.js";
export type { Book, Coverage, Quote, TokenName } from "./pool.js";
export { quoteCoverage } from "./quote.js";
export type { QuoteDeps, QuoteRefusal, QuoteRequest, QuoteResult } from "./quote.js";
export { MIN_CLAIM_GAS_TGAS, OwnerCoverage } from "./owner.js";
export type { BuyRequest, BuyResult, ClaimResult } from "./owner.js";
export { parseEvents } from "./events.js";
export type { ArunaEvent } from "./events.js";
