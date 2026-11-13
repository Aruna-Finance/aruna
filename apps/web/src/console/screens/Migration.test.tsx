import type { MigrationPlan } from "@aruna/sdk/vault";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MigrationView, type PlanState } from "./Migration";

const plan = (coverage: MigrationPlan["coverage"]): MigrationPlan =>
  ({
    oldVault: "old.factory2.arunafi.testnet",
    name: "old2",
    newVault: "old2.factory2.arunafi.testnet",
    factory: "factory2.arunafi.testnet",
    owner: "me.testnet",
    operator: null,
    oldVersion: "v1",
    targetVersion: "v2",
    ceiling: {},
    minDepositYocto: "1",
    agents: [{ publicKey: "ed25519:AAA", label: "trader", statusBefore: "Active", autoDisabledBefore: false, policy: {} }],
    revokedAgents: 1,
    agentsWithReservations: 0,
    funds: { near: { balanceYocto: "0", keepYocto: "0", movableYocto: (2n * 10n ** 24n).toString() }, tokens: [] },
    coverage,
    newVaultState: "absent",
    notes: ["Agents keep their keys."],
  }) as unknown as MigrationPlan;

const view = (p: PlanState, account: string | null = "me.testnet") =>
  renderToStaticMarkup(<MigrationView vault="old.factory2.arunafi.testnet" owner="me.testnet" account={account} name="old2" setName={() => {}} plan={p} check={() => {}} loading={false} error={null} />);

describe("Migration screen", () => {
  it("says it checks and does not send, and asks for a wallet", () => {
    const html = view({ state: "idle" }, null);
    expect(html).toContain("This page checks the plan. The migration itself runs from the");
    expect(html).toContain("Connect the owner");
  });

  it("puts the coverage warning first, before what it would do", () => {
    const html = view({ state: "ok", plan: plan({ status: "active", coverageIds: [4] }) });
    expect(html.indexOf("#4 stays bound to the old vault")).toBeGreaterThan(-1);
    expect(html.indexOf("Coverage. ")).toBeLessThan(html.indexOf("What it would do"));
  });

  it("shows the agents, the funds and a dry run before the real command", () => {
    const html = view({ state: "ok", plan: plan({ status: "none" }) });
    expect(html).toContain("trader");
    expect(html).toContain("2 NEAR");
    expect(html.indexOf("--dry-run")).toBeLessThan(html.indexOf("migrate old.factory2.arunafi.testnet --name old2 --factory factory2.arunafi.testnet --as me.testnet<"));
  });

  it("shows a refusal as nothing sent", () => {
    const html = view({ state: "refused", message: "only the owner can migrate it" });
    expect(html).toContain("The plan was refused. Nothing was sent.");
    expect(html).toContain("only the owner can migrate it");
  });

  it("asks for a vault when none is open", () => {
    const html = renderToStaticMarkup(<MigrationView vault={null} owner={null} account={null} name="" setName={() => {}} plan={{ state: "idle" }} check={() => {}} loading={false} error={null} />);
    expect(html).toContain("Open a vault first");
  });
});
