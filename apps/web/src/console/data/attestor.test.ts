import { describe, expect, it } from "vitest";
import { createAttestorStore } from "./attestor";
import { channelsOf, upgradeChannel } from "./channels";
import { createClaimsStore, resolvedHash } from "./claims-mock";
import { mockTargets } from "./mock";

describe("attestor console (mock)", () => {
  it("sees a global-contract redeploy on the owner channel, and names the other targets it affects", async () => {
    const all = await mockTargets.list();
    const router = all.find((t) => t.id === "router.testnet")!;
    expect(upgradeChannel(router)).toBe("deploy_global_contract");
    const s = createAttestorStore();
    const d = s.upgrade(router, all);
    expect(d.owner).toBe("owner.testnet");
    expect(d.affects).toEqual(["router-2.testnet"]);
    expect(channelsOf(router, d.channel).find((c) => c.key === "deploy_global_contract")?.state).toBe("changed");
  });

  it("cannot upgrade an immutable_verified target", async () => {
    const all = await mockTargets.list();
    const vault = all.find((t) => t.id === "vault.testnet")!;
    expect(() => createAttestorStore().upgrade(vault, all)).toThrow(/ARUNA_CANNOT_CHANGE/);
  });

  it("marks channels that do not apply to the code reference", async () => {
    const all = await mockTargets.list();
    const dex = all.find((t) => t.id === "dex.testnet")!;
    const states = Object.fromEntries(channelsOf(dex).map((c) => [c.key, c.state]));
    expect(states.use_global_contract).toBe("not applicable");
    expect(states.deploy_global_contract).toBe("not applicable");
  });

  it("rejects a report whose resolved hashes match, and one outside the lookback bound", () => {
    const claims = createClaimsStore();
    expect(() => claims.reportDrift("dex.testnet", { afterHash: resolvedHash("dex.testnet", "before") })).toThrow(/ARUNA_HASHES_EQUAL/);
    expect(() => claims.reportDrift("dex.testnet", { agoBlocks: 999_999 })).toThrow(/ARUNA_LOOKBACK_EXCEEDED/);
  });

  it("uses the attestor, channel and hash the form sent", () => {
    const claims = createClaimsStore();
    const r = claims.reportDrift("dex.testnet", { attestor: "attestor-2.testnet", channel: "deploy_contract", afterHash: "newhash123" });
    expect(r.attestor).toBe("attestor-2.testnet");
    expect(r.channel).toBe("deploy_contract");
    expect(r.afterResolvedHash).toBe("newhash123");
  });
});
