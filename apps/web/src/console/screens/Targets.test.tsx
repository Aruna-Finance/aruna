import type { ClassRecord } from "@aruna/sdk/coverage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Classification } from "@/landing/lib/classifier-types";
import type { RegistryTarget } from "../data/registry-live";
import type { RegistryTargets } from "../useRegistryTargets";
import type { RegistryTargetView } from "../useRegistryTargets";
import { TargetView } from "./TargetDetail";
import { TargetsView } from "./Targets";

const record: ClassRecord = {
  class: "global_by_account",
  classified_at_block: 1000,
  classifier: "classifier.testnet",
  evidence_hash: "EVHASH",
  frozen: false,
  resolved_code_hash: "RESOLVED",
  upgrade_authority: "owner.testnet",
};
const row = (o: Partial<RegistryTarget> = {}): RegistryTarget => ({ target: "drift-target.testnet", record, attestor: "attestor-a.testnet", heartbeatFresh: false, latest: null, ...o });

const list: RegistryTargets = { state: "ok", head: 1500, rows: [row(), row({ target: "never.testnet", record: null, attestor: null })] };

const fresh = (c: Classification["class"]): Classification =>
  ({
    class: c,
    evidence: {
      mutabilityBasis: "global_owner",
      checkedAtBlock: 1500,
      codeRef: { kind: "global_account", ownerAccount: "owner.testnet" },
      fullAccessKeyCount: 0,
      functionCallKeyCount: 1,
      resolvedCodeHash: "RESOLVED",
      upgradeImports: [],
      wasmParsed: true,
    },
  }) as unknown as Classification;

const detail = (live: Classification | null, liveProblem: string | null = null): RegistryTargetView => ({ state: "ok", head: 1500, target: row(), live, liveProblem });

describe("Targets screen", () => {
  it("lists recorded and unrecorded targets with attestor heartbeat", () => {
    const html = renderToStaticMarkup(<TargetsView data={list} />);
    expect(html).toContain("drift-target.testnet");
    expect(html).toContain("Not recorded");
    expect(html).toContain("heartbeat stale");
    expect(html).toContain("None assigned");
    expect(html).toContain("The registry has no list of its targets");
  });

  it("shows a read error, not a short list", () => {
    const html = renderToStaticMarkup(<TargetsView data={{ state: "error", message: "rpc down" }} />);
    expect(html).toContain("Couldn&#x27;t read the contract records."); expect(html).toContain("rpc down");
    expect(html).not.toContain("drift-target");
  });
});

describe("Target detail screen", () => {
  it("shows the record beside a fresh run and says when they agree", () => {
    const html = renderToStaticMarkup(<TargetView id="drift-target.testnet" data={detail(fresh("global_by_account"))} />);
    expect(html).toContain("Recorded in the registry");
    expect(html).toContain("EVHASH");
    expect(html).toContain("A fresh run of the classifier");
    expect(html).toContain("The recorded class is the class a fresh run gives.");
    expect(html).toContain("Why hash monitors miss this target");
  });

  it("says the code changed when the class agrees but the code hash does not", () => {
    const moved = fresh("global_by_account");
    (moved.evidence as { resolvedCodeHash: string }).resolvedCodeHash = "OTHER";
    const html = renderToStaticMarkup(<TargetView id="drift-target.testnet" data={detail(moved)} />);
    expect(html).toContain("is not the code that was recorded");
    expect(renderToStaticMarkup(<TargetView id="drift-target.testnet" data={detail(fresh("global_by_account"))} />)).toContain("is the code that was recorded");
  });

  it("says so when the recorded class differs from a fresh run", () => {
    const html = renderToStaticMarkup(<TargetView id="drift-target.testnet" data={detail(fresh("local_upgradeable"))} />);
    expect(html).toContain("differs from a fresh run");
  });

  it("keeps the record when the fresh run fails", () => {
    const html = renderToStaticMarkup(<TargetView id="drift-target.testnet" data={detail(null, "Public RPC did not answer.")} />);
    expect(html).toContain("EVHASH");
    expect(html).toContain("Public RPC did not answer.");
  });

  it("says a target nobody recorded cannot be covered", () => {
    const html = renderToStaticMarkup(<TargetView id="x.testnet" data={{ state: "ok", head: 1500, target: row({ record: null }), live: null, liveProblem: null }} />);
    expect(html).toContain("cannot cover it");
  });
});
