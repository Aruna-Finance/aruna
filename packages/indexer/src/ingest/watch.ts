// The accounts whose events are trusted (plan KTD2). Seeds are Aruna's registries, factories and pools;
// vaults join when one of the watched factories emits vault_created. An account outside this set can
// log a perfect-looking aruna event and it is still ignored.

export interface Seeds {
  factories: string[];
  contracts: string[];
}

export class WatchSet {
  private readonly factories: Set<string>;
  private readonly accounts: Set<string>;
  private readonly vaultFactory = new Map<string, string>();

  constructor(seeds: Seeds) {
    this.factories = new Set(seeds.factories);
    this.accounts = new Set([...seeds.factories, ...seeds.contracts]);
  }

  has(account: string): boolean {
    return this.accounts.has(account);
  }

  isFactory(account: string): boolean {
    return this.factories.has(account);
  }

  isVault(account: string): boolean {
    return this.vaultFactory.has(account);
  }

  addVault(vault: string, factory: string): void {
    this.accounts.add(vault);
    this.vaultFactory.set(vault, factory);
  }
}
