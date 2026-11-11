import { describe, expect, it } from "vitest";
import type { RpcReader, ViewAccount } from "@aruna/classifier-core";
import { Classifier } from "../src/index.js";
import { Registry, type ReadTransport } from "../src/coverage/index.js";

const ZERO = "11111111111111111111111111111111";
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const byAccount: ViewAccount = { exists: true, blockHeight: 1, codeHash: ZERO, globalContractHash: null, globalContractAccountId: "owner.testnet" };
const reader = (acct: ViewAccount, resolved = "LIVE"): RpcReader => ({
  viewAccount: async () => acct,
  viewAccessKeyList: async () => ({ keys: [] }),
  viewCode: async () => ({ codeBase64: b64([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), hash: resolved }),
});
const registry = (record: unknown, report: unknown = null) => {
  const t: ReadTransport = { view: async <T>(_c: string, m: string) => (m === "get_class" ? record : m === "latest_report" ? report : null) as T };
  return new Registry({ registry: "reg", transport: t });
};

describe("Classifier.watch", () => {
  it("reports the monitored and resolved hashes and why the first cannot show a change", async () => {
    const w = await new Classifier({ reader: reader(byAccount) }).watch("t.testnet");
    expect(w.class).toBe("global_by_account");
    expect(w.channels).toEqual({ monitoredCodeHash: ZERO, resolvedCodeHash: "LIVE", upgradeAuthority: "owner.testnet", changeInvisibleToCodeHash: true });
  });

  it("matches check()'s evidence: one engine, no second classification", async () => {
    const c = new Classifier({ reader: reader(byAccount) });
    const [w, k] = await Promise.all([c.watch("t.testnet"), c.check("t.testnet")]);
    expect(w.class).toBe(k.class);
    expect(w.channels.resolvedCodeHash).toBe(k.evidence.resolvedCodeHash);
  });

  it("without a registry it says so and compares nothing", async () => {
    const w = await new Classifier({ reader: reader(byAccount) }).watch("t.testnet");
    expect(w.recorded).toEqual({ state: "not consulted" });
    expect(w.changedSinceRecorded).toBeNull();
  });

  it("a live hash that differs from the recorded one is a change since recorded, with the latest report attached", async () => {
    const report = { id: 2, state: "Verified" };
    const w = await new Classifier({ reader: reader(byAccount, "NEW") }).watch("t.testnet", { registry: registry({ class: "global_by_account", resolved_code_hash: "OLD", frozen: true }, report) });
    expect(w.changedSinceRecorded).toBe(true);
    expect(w.recorded).toEqual({ state: "recorded", class: "global_by_account", resolvedCodeHash: "OLD", frozen: true });
    expect(w.latestReport).toEqual(report);
  });

  it("an unchanged hash is not a change", async () => {
    const w = await new Classifier({ reader: reader(byAccount, "SAME") }).watch("t.testnet", { registry: registry({ class: "global_by_account", resolved_code_hash: "SAME", frozen: false }) });
    expect(w.changedSinceRecorded).toBe(false);
  });

  it("a target the registry never recorded is not recorded, and nothing is compared", async () => {
    const w = await new Classifier({ reader: reader(byAccount) }).watch("t.testnet", { registry: registry(null) });
    expect(w).toMatchObject({ recorded: { state: "not recorded" }, changedSinceRecorded: null });
  });

  it("an account with no code returns the classifier's own unknown, not a throw", async () => {
    const w = await new Classifier({ reader: reader({ exists: false, blockHeight: 1 }) }).watch("nobody.testnet");
    expect(w.class).toBe("unknown");
    expect(w.channels.changeInvisibleToCodeHash).toBe(false);
  });
});
