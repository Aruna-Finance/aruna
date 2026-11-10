import type { VaultView } from "@aruna/sdk";
import { describe, expect, it } from "vitest";
import { createStoryStore, createSteps } from "./story";

const fakeVault = (autoDisabled: boolean) =>
  ({
    vault: "demo2.factory.arunafi.testnet",
    owner: "o.testnet",
    operator: "p.testnet",
    ceiling: null,
    exposure: null,
    fullAccessKeys: 0,
    agents: [{ publicKey: "ed25519:x", label: "injected", status: "Paused", autoDisabled, policy: {}, usage: null, key: null, cannot: [] }],
    unknownKeys: [],
    operatorCannot: [],
  }) as unknown as VaultView;

describe("guided demo", () => {
  it("runs the steps in order and refuses to skip ahead", async () => {
    const story = createStoryStore(createSteps(async () => fakeVault(true)));
    await story.run("buy");
    expect(Object.keys(story.get().done)).toEqual([]);
    await story.run("check");
    expect(story.get().done.check).toContain("global_by_account");
  });

  it("goes from a new agent to a paid claim and a rejected false report", async () => {
    const story = createStoryStore(createSteps(async () => fakeVault(true)));
    for (const s of story.steps) await story.run(s.id);
    const { done, error } = story.get();
    expect(error).toBeNull();
    expect(Object.keys(done)).toHaveLength(story.steps.length);
    expect(done.inject).toContain("auto-disabled");
    expect(done.tighten).toMatch(/fell from/);
    expect(done.payout).toMatch(/USDC paid from the pool/);
    expect(done.false).toMatch(/rejected/);
  });

  it("shows a failed live read as an error on the step, not as a crash", async () => {
    const story = createStoryStore(
      createSteps(async () => {
        throw new Error("network down");
      }),
    );
    await story.run("check");
    await story.run("create");
    await story.run("inject");
    expect(story.get().error).toContain("network down");
    expect(story.get().done.inject).toBeUndefined();
  });

  it("marks only the injected-agent step as live", () => {
    expect(createSteps().filter((s) => s.live).map((s) => s.id)).toEqual(["inject"]);
  });
});
