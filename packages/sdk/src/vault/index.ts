// @aruna/sdk/vault — signing clients for a vault, one per role. Kept apart from the keyless entry
// point so pages that only read never load a signer.
export { AgentVault, OperatorVault, OwnerVault } from "./clients.js";
export type { Policy, Simulation, SpendAction, SpendResult, Token } from "./clients.js";
export { ArunaAuthError, ArunaRpcError, VaultVersionError } from "./transport.js";
export type { CallResult, MigrationTransport, VaultTransport } from "./transport.js";
export { nearApiTransport } from "./near-transport.js";
export { CAPABILITIES, CURRENT_VAULT_HASH, CURRENT_VAULT_VERSION, KNOWN_VAULT_VERSIONS } from "./versions.js";
export { MigrationAborted, MigrationNeedsReview, MigrationRefused, MIGRATION_MARGIN_YOCTO, memoryJournal, planMigration, runMigration } from "./migrate.js";
export type { CarriedAgent, CoverageNotice, JournalFund, JournalStore, JournalTx, MigrationEvent, MigrationJournal, MigrationPlan, MigrationResult, PlanOptions, RunOptions, StepInfo } from "./migrate.js";
export type { VaultVersion } from "./versions.js";
