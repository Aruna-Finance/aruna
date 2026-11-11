// Reads of the registry: what class a target has on record, and the drift reports about it. Keyless.
import type { RegistryClassRecord, RegistryMethods, RegistryStoredReport } from "../generated/registry.js";
import type { ReadTransport } from "./transport.js";

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

  /** The newest drift report for a target, or null. */
  latestReport(target: string): Promise<DriftReport | null> {
    return this.view("latest_report", { target });
  }
}
