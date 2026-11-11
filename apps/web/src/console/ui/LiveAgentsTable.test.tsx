import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentView } from "@aruna/sdk";
import { actorFor, chosenVault, noActorReason } from "../live-vault";
import { LiveAgentsTable } from "./LiveAgentsTable";

const agent = (o: Partial<AgentView> = {}): AgentView => ({
  publicKey: "ed25519:AAA",
  label: "trader",
  status: "Active",
  autoDisabled: false,
  policy: { maxPerTx: "1", dailyCap: "400000000000000000000000", maxSlippageBps: 100, allowedTargets: [], maxRiskClass: "local_upgradeable", limits: [{ token: "near", maxPerTx: "1", dailyCap: "400000000000000000000000" }] },
  usage: null,
  usageByToken: [{ token: "near", spentToday: "100000000000000000000000", reserved: "0" }],
  key: null,
  cannot: [],
  ...o,
});
const noop = () => {};
const html = (agents: AgentView[], held: string[], actor: "owner" | "operator" | null) =>
  renderToStaticMarkup(<LiveAgentsTable agents={agents} held={held} actor={actor} blockedReason={noActorReason(null)} onPause={noop} onResume={noop} onRevoke={noop} />);

describe("which role the wallet acts as", () => {
  it("an owner may look as the operator, an operator may never act as the owner, a stranger acts as nobody", () => {
    expect(actorFor("owner", "owner")).toBe("owner");
    expect(actorFor("owner", "operator")).toBe("operator");
    expect(actorFor("operator", "owner")).toBe("operator");
    expect(actorFor("none", "owner")).toBeNull();
    expect(actorFor(null, "owner")).toBeNull();
  });
  it("takes the vault from the link first, then the remembered one, and only if it is a valid account id", () => {
    const valid = (id: string) => id.endsWith(".testnet");
    expect(chosenVault("a.testnet", "b.testnet", valid)).toBe("a.testnet");
    expect(chosenVault(null, "b.testnet", valid)).toBe("b.testnet");
    expect(chosenVault("bad", "b.testnet", valid)).toBe("b.testnet");
    expect(chosenVault("bad", "worse", valid)).toBeNull();
  });
});

describe("live agents table", () => {
  const auto = agent({ status: "Paused", autoDisabled: true });
  it("AE1: the operator sees resume disabled with the reason, the owner sees it enabled", () => {
    const op = html([auto], ["ed25519:AAA"], "operator");
    expect(op).toContain("only the owner can resume an auto-disabled agent");
    expect(op).toMatch(/<button[^>]*disabled=""[^>]*>Resume/);
    expect(html([auto], ["ed25519:AAA"], "owner")).not.toMatch(/<button[^>]*disabled=""[^>]*>Resume/);
  });
  it("AE5: a key not held here is marked, and revoke stays enabled", () => {
    const out = html([agent()], [], "owner");
    expect(out).toContain("Not in this browser");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Revoke/);
  });
  it("the label links to the agent detail page by public key", () => {
    expect(html([agent()], [], "owner")).toContain("/console/agents/detail?agent=ed25519%3AAAA");
  });
  it("a held key is shown as in this browser", () => {
    expect(html([agent()], ["ed25519:AAA"], "owner")).toContain("In this browser");
  });
  it("a wallet that may not act sees every action disabled with one reason", () => {
    const out = html([agent()], [], null);
    expect(out).toContain("connect the owner&#x27;s or operator&#x27;s wallet to act");
    expect(out).not.toMatch(/<button(?![^>]*disabled)[^>]*>(Pause|Revoke)/);
  });
  it("a revoked agent shows no actions at all, like the sample table", () => {
    const out = html([agent({ status: "Revoked" })], [], "owner");
    expect(out).toContain("Deleted");
    expect(out).not.toContain("<button");
  });
  it("shows NEAR usage against the daily limit, and an empty vault says so", () => {
    expect(html([agent()], [], "owner")).toContain("0.1 of 0.4 NEAR");
    expect(html([], [], "owner")).toContain("no agents yet");
  });
});
