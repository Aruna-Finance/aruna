// @aruna/sdk/coverage — the coverage half of the SDK: registry and pool reads (keyless), the quote,
// and the owner's purchase and claim. Kept apart from the keyless root entry like @aruna/sdk/vault.
export { fetchViewTransport } from "./transport.js";
export type { ReadTransport } from "./transport.js";
export { Registry } from "./registry.js";
export type { ClassRecord, DriftReport } from "./registry.js";
export { Pool, tokenId } from "./pool.js";
export type { Book, Coverage, Quote, TokenName } from "./pool.js";
export { quoteCoverage } from "./quote.js";
export type { QuoteDeps, QuoteRefusal, QuoteRequest, QuoteResult } from "./quote.js";
