// Vault versions this SDK supports, by global contract hash (docs/SDK.md "Versioning"). Vaults are
// immutable, so several run at once. A vault on any other hash is refused loudly.
export type VaultVersion = "v1" | "v2" | "v3" | "v4";

export const KNOWN_VAULT_VERSIONS: Readonly<Record<string, VaultVersion>> = {
  "5s1ggttSbdcSxSCjRyxqKmWUC7sCR6MLB26z7eMLhPhq": "v1",
  "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam": "v2",
  "2NvTPrL33u6SXVmdEDN2i8iYp76eMf9kPFJK7zGscmSH": "v3",
  "6fqp3des9ZNAdV3NfAWz8RDrXsqDnpRwqJ4BJAqzuFEh": "v4",
};

/**
 * What each version can do. v1 has no spend path; tokens arrive in v3; simulate in v4. `yoctoOnOwnerMethods`:
 * the owner's power-granting methods (withdraw, add agent, resume, set operator, ...) need exactly
 * 1 yoctoNEAR from v2 on (AUDIT-v0 H1); v1 predates that and is not payable, so a deposit would panic.
 */
export const CAPABILITIES: Readonly<Record<VaultVersion, { spend: boolean; tokens: boolean; simulate: boolean; yoctoOnOwnerMethods: boolean }>> = {
  v1: { spend: false, tokens: false, simulate: false, yoctoOnOwnerMethods: false },
  v2: { spend: true, tokens: false, simulate: false, yoctoOnOwnerMethods: true },
  v3: { spend: true, tokens: true, simulate: false, yoctoOnOwnerMethods: true },
  v4: { spend: true, tokens: true, simulate: true, yoctoOnOwnerMethods: true },
};

/** The version new vaults are made from, and the one a migration moves to. Add a version to the list above in the same change that publishes it. */
export const CURRENT_VAULT_VERSION: VaultVersion = "v4";
export const CURRENT_VAULT_HASH: string = Object.entries(KNOWN_VAULT_VERSIONS).find(([, v]) => v === CURRENT_VAULT_VERSION)![0];
