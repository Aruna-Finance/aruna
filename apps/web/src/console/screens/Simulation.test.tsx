import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SIM } from "../data/simulation-published";
import { Simulation } from "./Simulation";

const html = renderToStaticMarkup(<Simulation />);

describe("Simulation screen", () => {
  it("lists every scenario as a column and sets the breaking one apart", () => {
    for (const s of SIM.scenarios) expect(html).toContain(s.title.replace(/'/g, "&#x27;"));
    expect(html).toContain("The scenario that breaks the pool");
    expect(html).toContain("The pool breaks in this scenario.");
  });

  it("labels P(event) as an underwriting assumption, not a measurement", () => {
    expect(html).toContain("Underwriting assumption, not a measurement.");
    expect(html).toContain("None is measured.");
  });

  it("reads 'not insolvent within 60 days' for solvent scenarios", () => {
    expect(html).toContain("not insolvent within 60 days");
    expect(html).not.toContain("never");
  });

  it("marks the counterfactual and has no sample-data language", () => {
    expect(html).toContain("counterfactual, not the contract");
    expect(html).not.toMatch(/prototype|does not exist yet|Runs in your browser/);
  });
});
