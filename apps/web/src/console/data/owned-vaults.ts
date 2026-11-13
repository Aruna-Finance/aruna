import { KNOWN_VAULT_VERSIONS } from "@aruna/sdk/vault";

// Which vaults an account owns, read from the registry and not from the indexer. The factory registers every vault it makes, with
// the owner at registration, and the registry can list the vaults that run a given code hash. So the console can find a new
// vault the moment it is registered, with no indexer. Two limits, both stated where the list is shown: the owner is the one
// recorded at registration (a vault whose ownership moved is not followed), and an operator is not recorded, so the vaults an
// account only operates still come from the indexer.

export interface OwnedVault {
  vault: string;
  version: string;
  registeredAtBlock: number;
}

export interface RegisteredLike {
  vault: string;
  owner: string;
  registered_at_block: number;
}

export interface VaultsByHash {
  vaultsByCodeHash(codeHash: string): Promise<RegisteredLike[]>;
}

/** The vaults `account` owned when they were registered, newest first. A failed read throws; the list is never partial. */
export async function ownedVaults(registry: VaultsByHash, account: string, hashes: Readonly<Record<string, string>> = KNOWN_VAULT_VERSIONS): Promise<OwnedVault[]> {
  const found = await Promise.all(
    Object.entries(hashes).map(async ([hash, version]) =>
      (await registry.vaultsByCodeHash(hash)).filter((v) => v.owner === account).map((v) => ({ vault: v.vault, version, registeredAtBlock: v.registered_at_block })),
    ),
  );
  return found.flat().sort((a, b) => b.registeredAtBlock - a.registeredAtBlock || a.vault.localeCompare(b.vault));
}

/** The vault to open when nothing was asked for: the account's newest. */
export const newestOwned = (list: readonly OwnedVault[]): string | null => list[0]?.vault ?? null;

/** Indexer rows and registry rows as one list, each vault once. The owner role wins over the operator role. */
export function mergeVaultRows(
  fromIndexer: readonly { vault: string; role: string }[],
  fromRegistry: readonly OwnedVault[],
): { vault: string; role: string }[] {
  const out = new Map<string, { vault: string; role: string }>();
  for (const r of fromRegistry) out.set(r.vault, { vault: r.vault, role: "owner" });
  for (const r of fromIndexer) if (!out.has(r.vault) || r.role === "owner") out.set(r.vault, r);
  return [...out.values()];
}
