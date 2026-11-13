import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RegistryTarget } from "../data/registry-live";
import type { AttestorsLive } from "../useRegistryTargets";
import { AttestorView } from "./Attestor";

const YOCTO = 10n ** 24n;
const row = (target: string, attestor: string | null): RegistryTarget => ({ target, record: null, attestor, heartbeatFresh: false, latest: null });
const ok = (beat: number, bond = YOCTO.toString()): AttestorsLive => ({
  state: "ok",
  head: 2000,
  rows: [row("drift.testnet", "att-a.testnet"), row("swap.testnet", null)],
  attestors: [{ id: "att-a.testnet", record: { signing_key: "ed25519:KEY", bond, last_heartbeat: beat, registered_at: 5 } }],
});

describe("Attestor screen", () => {
  it("shows a stale heartbeat, the bond and the target it watches", () => {
    const html = renderToStaticMarkup(<AttestorView data={ok(1000)} />);
    expect(html).toContain("att-a.testnet");
    expect(html).toContain("Heartbeat stale");
    expect(html).toContain("1,000 blocks ago (stale after 600)");
    expect(html).toContain("1 NEAR");
    expect(html).toContain("drift.testnet");
  });

  it("reads a fresh heartbeat as fresh", () => {
    expect(renderToStaticMarkup(<AttestorView data={ok(1900)} />)).toContain("Heartbeat fresh.");
  });

  it("says a slashed attestor cannot report", () => {
    expect(renderToStaticMarkup(<AttestorView data={ok(1900, "0")} />)).toContain("No bond (slashed)");
  });

  it("names the targets without an attestor and that the pool refuses them", () => {
    const html = renderToStaticMarkup(<AttestorView data={ok(1900)} />);
    expect(html).toContain("No attestor is assigned to swap.testnet.");
  });

  it("shows a read error, not a partial list", () => {
    const html = renderToStaticMarkup(<AttestorView data={{ state: "error", message: "rpc down" }} />);
    expect(html).toContain("Couldn&#x27;t read the contract records."); expect(html).toContain("rpc down");
    expect(html).not.toContain("att-a");
  });
});
