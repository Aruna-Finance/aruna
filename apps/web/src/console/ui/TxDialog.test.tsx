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
    expect(html).toContain("not an error");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("https://testnet.nearblocks.io/txns/H");
  });
  it("shows a failure as an alert, and warns when it may have run", () => {
    const html = renderToStaticMarkup(<PhaseView phase={{ kind: "failed", message: "timeout", reason: null, sent: false }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("check the explorer before you retry");
  });
  it("says a cancel sent nothing", () => {
    expect(renderToStaticMarkup(<PhaseView phase={{ kind: "cancelled" }} />)).toContain("Nothing was sent");
  });
  it("renders nothing while idle", () => {
    expect(renderToStaticMarkup(<PhaseView phase={{ kind: "idle" }} />)).toBe("");
  });
});
