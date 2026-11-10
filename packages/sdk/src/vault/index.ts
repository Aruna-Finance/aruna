// @aruna/sdk/vault — signing clients for a vault, one per role. Kept apart from the keyless entry
// point so pages that only read never load a signer.
export { AgentVault, OperatorVault, OwnerVault } from "./clients.js";
export type { Policy, Simulation, SpendAction, SpendResult, Token } from "./clients.js";
export { ArunaAuthError, ArunaRpcError, VaultVersionError } from "./transport.js";
export type { CallResult, VaultTransport } from "./transport.js";
export { nearApiTransport } from "./near-transport.js";
export { CAPABILITIES, KNOWN_VAULT_VERSIONS } from "./versions.js";
export type { VaultVersion } from "./versions.js";
