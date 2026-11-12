// Reads of the registry: what class a target has on record, and the drift reports about it. Keyless.
import type { RegistryClassRecord, RegistryMethods, RegistryStoredReport, RegistryVaultPage, RegistryVaultRecord } from "../generated/registry.js";
import type { ReadTransport } from "./transport.js";

/** A vault as the registry recorded it when the factory registered it. */
export type RegisteredVault = RegistryVaultRecord;
export type VaultPage = RegistryVaultPage;

export type ClassRecord = RegistryClassRecord;
/** A drift report with its state as of now: a Pending report whose window has closed reads as verified. */
export type DriftReport = RegistryStoredReport;

type Method = keyof RegistryMethods & string;

export class Registry {
  constructor(private readonly o: { registry: string; transport: ReadTransport }) {}

  private view<M extends Method>(method: M, args: RegistryMethods[M]["args"]): Promise<RegistryMethods[M]["result"]> {
    return this.o.transport.view(this.o.registry, method, args as Record<string, unknown>);
  }

  get registryId(): string {
    return this.o.registry;
  }

  /** The class recorded for a target, or null if it was never classified into this registry. */
  classOf(target: string): Promise<ClassRecord | null> {
    return this.view("get_class", { target });
  }

  /** A drift report by id, or null. */
  report(id: number): Promise<DriftReport | null> {
    return this.view("get_report", { id });
  }

  /**
   * One page of the vaults running `codeHash`. A call examines a bounded window of the registry's vault
   * list, so a page can be empty while `next` is set: keep following `next` until it is null.
   */
  vaultsByCodeHashPage(codeHash: string, o: { from?: number; limit?: number } = {}): Promise<VaultPage> {
    return this.view("vaults_by_code_hash", { code_hash: codeHash, from: o.from ?? null, limit: o.limit ?? null });
  }

  /**
   * Every vault the registry knows that runs `codeHash`, with the owner recorded at registration (not
   * necessarily the current owner: read that from the vault). Empty for an unknown hash.
   */
  async vaultsByCodeHash(codeHash: string): Promise<RegisteredVault[]> {
    const out: RegisteredVault[] = [];
    let from = 0;
    for (;;) {
      const page = await this.vaultsByCodeHashPage(codeHash, { from });
      out.push(...page.items);
      const next = page.next ?? null;
      if (next === null) return out;
      if (next <= from) throw new Error(`registry ${this.o.registry} returned a non-advancing cursor (${next} after ${from})`);
      from = next;
    }
  }

  /** The newest drift report for a target, or null. */
  latestReport(target: string): Promise<DriftReport | null> {
    return this.view("latest_report", { target });
  }
}
