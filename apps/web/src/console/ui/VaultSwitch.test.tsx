import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VaultSwitchView } from "./VaultSwitch";

const two = [{ value: "b.f", label: "b.f" }, { value: "a.f", label: "a.f" }];

describe("VaultSwitch", () => {
  it("shows the current vault as text with a Switch vault button when there is more than one", () => {
    const html = renderToStaticMarkup(<VaultSwitchView vault="b.f" options={two} onPick={() => {}} />);
    expect(html).toContain("b.f");
    expect(html).toContain("Switch vault");
    expect(html).not.toContain("<ul");
  });
  it("shows the list after the button is pressed", () => {
    const html = renderToStaticMarkup(<VaultSwitchView vault="b.f" options={two} onPick={() => {}} startOpen />);
    expect(html).toContain("<ul");
    expect(html).toContain("a.f");
  });
  it("is just the name when there is only one vault", () => {
    const html = renderToStaticMarkup(<VaultSwitchView vault="b.f" options={[two[0]]} onPick={() => {}} />);
    expect(html).not.toContain("Switch vault");
    expect(html).toContain("b.f");
  });
});
