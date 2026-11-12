import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityItem, ExposureRow } from "@aruna/indexer/client";
import type { HistoryState } from "../history";
import { ActivityList } from "./ActivityList";
import { ExposureHistory } from "./ExposureHistory";
import { HistoryBlock } from "./HistoryBlock";

const ref = { seq: 1, block: 277069050, timestamp_ms: 0, tx_hash: "TXHASH1", receipt_id: "r" };
const item = (o: Partial<ActivityItem> = {}): ActivityItem => ({ ...ref, kind: "refused", event: "execution_refused", vault: "v.testnet", agent: "ed25519:AAA", target: "attacker.testnet", amount: "200000000000000000000000", token: "near", reason: "ARUNA_TARGET_NOT_ALLOWED", class: null, data: {}, ...o });
const row = (o: Partial<ExposureRow> = {}): ExposureRow => ({ ...ref, vault: "v.testnet", agent: "ed25519:AAA", target: "swap.arunafi.testnet", token: "near", amount: "100000000000000000000000", total: "300000000000000000000000", class: "local_upgradeable", ...o });

describe("activity list", () => {
  it("a refusal shows its reason code, the class at refusal and a link to its transaction", () => {
    const out = renderToStaticMarkup(<ActivityList items={[item({ class: "local_upgradeable" })]} empty="none" />);
    expect(out).toContain("ARUNA_TARGET_NOT_ALLOWED");
    expect(out).toContain("Target class at refusal: local_upgradeable");
    expect(out).toContain("https://testnet.nearblocks.io/txns/TXHASH1");
  });
  it("says when the vault had no class cached for the refused target", () => {
    expect(renderToStaticMarkup(<ActivityList items={[item()]} empty="none" />)).toContain("none cached");
  });
  it("uses the agent label when it knows one, and says nothing was found when empty", () => {
    expect(renderToStaticMarkup(<ActivityList items={[item()]} empty="none" agentLabel={() => "trader"} />)).toContain("trader");
    expect(renderToStaticMarkup(<ActivityList items={[]} empty="No events yet." />)).toContain("No events yet.");
  });
});

describe("exposure history", () => {
  it("shows the class recorded with the row, the running total, and says exposure is not a position's value", () => {
    const out = renderToStaticMarkup(<ExposureHistory rows={[row()]} empty="none" />);
    expect(out).toContain("local_upgradeable");
    expect(out).toContain("0.3 NEAR");
    expect(out).toContain("not the current value of any position");
    expect(out).toContain("TXHASH1");
  });
});

describe("history block", () => {
  const live: HistoryState<ActivityItem> = { state: "live", items: [], lastIndexedBlock: 1, next: null, pending: [] };
  it("AE2: unavailable says since which block and draws no list", () => {
    const out = renderToStaticMarkup(
      <HistoryBlock h={{ state: "unavailable", lastKnownBlock: 277069048, reason: "x", pending: [] }} source="live">
        <p>THE LIST</p>
      </HistoryBlock>,
    );
    expect(out).toContain("unavailable since block 277,069,048");
    expect(out).not.toContain("THE LIST");
  });
  it("a transaction the indexer has not caught up with shows as pending", () => {
    const out = renderToStaticMarkup(
      <HistoryBlock h={{ ...live, state: "behind", pending: [{ hash: "PENDINGTX", vault: "v", label: "Pause agent", sentAt: 0 }] }} source="live">
        <p>THE LIST</p>
      </HistoryBlock>,
    );
    expect(out).toContain("Pending: Pause agent");
    expect(out).toContain("THE LIST");
  });
  it("with no indexer connected, an empty sample is not drawn as an empty vault", () => {
    const out = renderToStaticMarkup(<HistoryBlock h={live} source="fixture"><p>THE LIST</p></HistoryBlock>);
    expect(out).toContain("History is not connected in this build");
    expect(out).not.toContain("THE LIST");
    expect(renderToStaticMarkup(<HistoryBlock h={{ ...live, items: [{} as ActivityItem] }} source="fixture"><p>THE LIST</p></HistoryBlock>)).toContain("THE LIST");
  });
  it("sample data is labelled as such, live data has no notice, and a pending read says it is reading", () => {
    expect(renderToStaticMarkup(<HistoryBlock h={{ ...live, items: [{} as ActivityItem] }} source="fixture"><i /></HistoryBlock>)).toContain("Recorded sample history");
    expect(renderToStaticMarkup(<HistoryBlock h={live} source="live"><i /></HistoryBlock>)).not.toContain("Recorded sample");
    expect(renderToStaticMarkup(<HistoryBlock h={null} source="live"><i /></HistoryBlock>)).toContain("Reading history");
  });
});
