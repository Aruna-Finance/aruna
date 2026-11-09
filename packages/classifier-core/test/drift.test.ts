// The invisible drift case (docs/TESTING.md), replayed from a real testnet run of
// fixtures/drift-demo.mjs: fx-gowner redeployed v2 by account id, nothing touched fx-guser.
import { describe, expect, it } from "vitest";
import { classify } from "../src/index.js";
import type { RpcReader } from "../src/index.js";
import before from "../../../fixtures/snapshots/fx-guser.json" with { type: "json" };
import after from "../../../fixtures/snapshots/fx-guser-after-v2.json" with { type: "json" };

const replay = (s: typeof before): RpcReader => ({
  viewAccount: async () => s.viewAccount as never,
  viewAccessKeyList: async () => s.viewAccessKeyList as never,
  viewCode: async () => s.viewCode as never,
});

describe("invisible drift on a global_by_account target", () => {
  it("monitored field unchanged, resolved hash changed, class global_by_account both times", async () => {
    const b = await classify(before.accountId, replay(before));
    const a = await classify(after.accountId, replay(after as typeof before));
    expect(a.evidence.monitoredCodeHash).toBe(b.evidence.monitoredCodeHash);
    expect(a.evidence.resolvedCodeHash).not.toBe(b.evidence.resolvedCodeHash);
    expect(b.class).toBe("global_by_account");
    expect(a.class).toBe("global_by_account");
  });

  it("the resolved hashes are the committed v1 and v2 builds", async () => {
    expect(before.viewCode?.hash).toBe("8ijWM1kfo9EdYWpRJfsa7HKsx3zAWkXTVr3tHsA9CEoW");
    expect(after.viewCode?.hash).toBe("6ptQjUdp6CHh7crhRVTDoSwFJ2inLHESt4q4b8FcxdeA");
  });
});
