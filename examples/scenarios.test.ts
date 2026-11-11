import { readFileSync } from "node:fs";
import { AUTO_DISABLE_REASONS, REASONS } from "@aruna/sdk";
import { describe, expect, it } from "vitest";
import { AUTO_DISABLED_AT, EXAMPLE_POLICY, honestSwap, injectedScenario, minOutFor, nearToYocto, POISONED_TOOL_RESULT } from "./scenarios.ts";

const SWAP = "swap.arunafi.testnet";

/** The recorded injected run in examples/README.md: each attempt's intent, target, amount and refusal. */
function recordedInjectedRun() {
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  const start = readme.indexOf("`node examples/injected-agent.ts` (the second run");
  const block = readme.slice(start, readme.indexOf("```\n\n", readme.indexOf("```", start) + 3));
  const balance = /balance (\d+\.\d{4}) NEAR/.exec(block)![1];
  const rows = [...block.matchAll(/^(\d)\. (.+): spend\(([^,]+), (\d+\.\d{4}) NEAR\)\n\s+Blocked ARUNA_([A-Z_]+)/gm)];
  return { balance, rows: rows.map((m) => ({ intent: m[2], target: m[3], amount: m[4], reason: m[5] })) };
}

/** yoctoNEAR to the 4-decimal NEAR the recorded run prints. */
const fmt4 = (yocto: string) => {
  const v = BigInt(yocto);
  return `${v / 10n ** 24n}.${(v % 10n ** 24n).toString().padStart(24, "0").slice(0, 4)}`;
};

describe("injectedScenario", () => {
  const recorded = recordedInjectedRun();
  const attempts = injectedScenario({ swap: SWAP, balance: nearToYocto(recorded.balance) });

  it("yields the recorded run's attempts, in its order, with its refusals", () => {
    expect(recorded.rows).toHaveLength(6);
    expect(attempts.map((a) => ({ intent: a.intent, target: a.action.target, amount: fmt4(a.action.amount), reason: a.expected }))).toEqual(recorded.rows);
  });

  it("is refused for agent-caused reasons up to the auto-disable, then as auto-disabled", () => {
    for (const a of attempts.slice(0, AUTO_DISABLED_AT)) expect(AUTO_DISABLE_REASONS).toContain(a.expected);
    expect(attempts.slice(AUTO_DISABLED_AT).map((a) => a.expected)).toEqual(["AGENT_AUTO_DISABLED"]);
    for (const a of attempts) expect(REASONS).toContain(a.expected);
  });

  it("uses only the named swap adapter, never a free-form call", () => {
    for (const a of attempts) expect(a.action.adapter).toBe("swap");
  });

  it("the last attempt is the honest swap, inside the example policy", () => {
    const last = attempts.at(-1)!.action;
    expect(last).toEqual(honestSwap({ swap: SWAP, amount: nearToYocto("0.1") }));
    expect(BigInt(last.amount) <= BigInt(EXAMPLE_POLICY.maxPerTx)).toBe(true);
  });

  it("the poisoned text names the attacker the first attempt pays", () => {
    expect(POISONED_TOOL_RESULT).toContain(attempts[0].action.target);
  });
});

describe("honestSwap", () => {
  it("asks for 99.5% back, inside the policy's 1% slippage", () => {
    const a = honestSwap({ swap: SWAP });
    expect(a).toEqual({ adapter: "swap", target: SWAP, amount: "100000000000000000000000", minAmountOut: "99500000000000000000000" });
    expect(BigInt(a.minAmountOut) * 10_000n >= BigInt(a.amount) * BigInt(10_000 - EXAMPLE_POLICY.maxSlippageBps)).toBe(true);
  });

  it("minOutFor rounds down, so it never asks for more than was sent", () => {
    expect(minOutFor("1")).toBe("0");
    expect(minOutFor("10000")).toBe("9950");
  });
});

describe("nearToYocto", () => {
  it("converts decimal NEAR exactly", () => {
    expect(nearToYocto("2.9963")).toBe("2996300000000000000000000");
    expect(nearToYocto("1")).toBe("1000000000000000000000000");
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", "-1", "1e3", "0.1234567890123456789012345", "1,5"]) expect(() => nearToYocto(bad)).toThrow();
  });
});
