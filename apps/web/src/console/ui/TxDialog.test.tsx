import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { depositText, gasText, PhaseView } from "./TxDialog";

describe("deposit and gas text", () => {
  it("never hides a deposit", () => {
    expect(depositText(undefined)).toBe("none");
    expect(depositText("0")).toBe("none");
    expect(depositText("1")).toBe("1 yoctoNEAR");
    expect(depositText("500000000000000000000000")).toBe("0.5 NEAR");
  });
  it("shows gas in Tgas", () => {
    expect(gasText("150000000000000")).toBe("150 Tgas");
    expect(gasText(undefined)).toBeNull();
  });
});

describe("PhaseView", () => {
  it("shows a refusal as a recorded outcome with its code, not as an error", () => {
    const html = renderToStaticMarkup(<PhaseView phase={{ kind: "refused", reason: "TARGET_NOT_ALLOWED", targetClass: "local_upgradeable", hash: "H" }} />);
    expect(html).toContain("ARUNA_TARGET_NOT_ALLOWED");
    expect(html).toContain("Blocked by the vault. This agent isn&#x27;t allowed to use that contract.");
    expect(html).toContain("the refusal is recorded");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("https://testnet.nearblocks.io/txns/H");
  });
  it("shows a pool refusal as the pool's, without claiming the vault recorded it", () => {
    const html = renderToStaticMarkup(<PhaseView source="pool" phase={{ kind: "refused", reason: "CAPITAL_LOCKED", targetClass: null, hash: null }} />);
    expect(html).toContain("Blocked by the pool.");
    expect(html).toContain("locked");
    expect(html).toContain("ARUNA_CAPITAL_LOCKED");
    expect(html).toContain("No funds moved.");
    expect(html).not.toContain("vault");
    expect(html).not.toContain("recorded");
    expect(html).not.toContain('role="alert"');
  });
  it("says a refunded deposit was returned by the token, with no contract code it never had", () => {
    const html = renderToStaticMarkup(<PhaseView source="pool" phase={{ kind: "refused", reason: "DEPOSIT_REFUNDED", targetClass: null, hash: "H" }} />);
    expect(html).toContain("Returned by the token.");
    expect(html).toContain("back in your wallet");
    expect(html).not.toContain("ARUNA_DEPOSIT_REFUNDED");
    expect(html).toContain("https://testnet.nearblocks.io/txns/H");
  });
  it("explains an unregistered payout before anything was sent", () => {
    const html = renderToStaticMarkup(<PhaseView source="pool" phase={{ kind: "refused", reason: "PAYOUT_NOT_REGISTERED", targetClass: null, hash: null }} />);
    expect(html).toContain("isn&#x27;t registered");
    expect(html).not.toContain("ARUNA_PAYOUT_NOT_REGISTERED");
  });
  it("shows an unknown pool reason as a generic refusal with its code, and does not throw", () => {
    const html = renderToStaticMarkup(<PhaseView source="pool" phase={{ kind: "refused", reason: "SOMETHING_NEW", targetClass: null, hash: null }} />);
    expect(html).toContain("The pool refused this action.");
    expect(html).toContain("ARUNA_SOMETHING_NEW");
  });
  it("tells an underwriter whose outcome could not be read that funds may have moved, and where to look", () => {
    const html = renderToStaticMarkup(<PhaseView source="pool" phase={{ kind: "failed", message: "outcome unknown", reason: null, sent: false }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Funds may have moved");
    expect(html).toContain("your balance and your position in the pool");
  });
  it("shows a failure as an alert, and warns when it may have run", () => {
    const html = renderToStaticMarkup(<PhaseView phase={{ kind: "failed", message: "timeout", reason: null, sent: false }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Check the explorer before you try again, in case it ran.");
  });
  it("says a cancel sent nothing", () => {
    expect(renderToStaticMarkup(<PhaseView phase={{ kind: "cancelled" }} />)).toContain("Nothing was sent");
  });
  it("renders nothing while idle", () => {
    expect(renderToStaticMarkup(<PhaseView phase={{ kind: "idle" }} />)).toBe("");
  });
});
