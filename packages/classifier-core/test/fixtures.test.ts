// Replays the recorded testnet answers for the four fixture accounts (fixtures/README.md) offline.
import { describe, expect, it } from "vitest";
import { classify } from "../src/index.js";
import type { RpcReader } from "../src/index.js";
import imm from "../../../fixtures/snapshots/fx-imm.json" with { type: "json" };
import upg from "../../../fixtures/snapshots/fx-upg.json" with { type: "json" };
import guser from "../../../fixtures/snapshots/fx-guser.json" with { type: "json" };
import nocode from "../../../fixtures/snapshots/fx-nocode.json" with { type: "json" };

type Snapshot = typeof imm | typeof upg | typeof guser | typeof nocode;

const replay = (s: Snapshot): RpcReader => ({
  viewAccount: async () => s.viewAccount as never,
  viewAccessKeyList: async () => s.viewAccessKeyList as never,
  viewCode: async () => s.viewCode as never,
});

describe("testnet fixtures, replayed", () => {
  it.each([
    [imm, "immutable_verified", "no_detected_path"],
    [upg, "local_upgradeable", "full_access_key"],
    [guser, "global_by_account", "global_owner"],
    [nocode, "unknown", "undetermined"],
  ] as const)("%# %s", async (snap, cls, basis) => {
    const c = await classify(snap.accountId, replay(snap));
    expect(c.class).toBe(cls);
    expect(c.evidence.mutabilityBasis).toBe(basis);
    expect(c.class).toBe(snap.classifiedLive.class);
  });

  it("the immutable fixture holds a function-call key and no full-access key", async () => {
    const c = await classify(imm.accountId, replay(imm));
    expect(c.evidence.fullAccessKeyCount).toBe(0);
    expect(c.evidence.functionCallKeyCount).toBeGreaterThanOrEqual(1);
  });

  it("the global_by_account fixture's monitored field is the zero hash while the resolved code is real", async () => {
    const c = await classify(guser.accountId, replay(guser));
    expect(c.evidence.monitoredCodeHash).toBe("11111111111111111111111111111111");
    expect(c.evidence.resolvedCodeHash).not.toBe(c.evidence.monitoredCodeHash);
  });
});
