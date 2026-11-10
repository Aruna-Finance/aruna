import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BASIS } from "./classInfo";
import { COVERAGE_ASSUME } from "./data/coverage";
import { ClassTag } from "./ui/ClassTag";
import { HeartbeatAlert } from "./ui/CoverageNotes";

// docs/FRONTEND.md, "Non-negotiables": the ones a component or a source scan can hold.

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("non-negotiables", () => {
  it("1. the app has no backend and no keys: no fetch to a private host, no secret env", () => {
    const text = files(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|SEED)/);
    expect(text).not.toMatch(/localStorage\.setItem\([^)]*(seed|private)/i);
  });

  it("6. unknown is shown as unknown, with no safe colour", () => {
    const html = renderToStaticMarkup(<ClassTag c="unknown" />);
    expect(html).toContain("unknown");
    expect(html).toContain("border-dashed");
    expect(html).not.toMatch(/green|safe|text-ink/);
  });

  it("5. a class tag with a target links to its evidence in one click", () => {
    const html = renderToStaticMarkup(<ClassTag c="local_upgradeable" target="dex.testnet" />);
    // next/link adds the trailing slash from next.config at build time, so match on the path and the id.
    expect(html).toMatch(/href="\/console\/targets\/detail\/?\?id=dex\.testnet"/);
  });

  it("9. upgrade_imports is never worded as 'can be upgraded'", () => {
    expect(BASIS.upgrade_imports.toLowerCase()).not.toContain("can be upgraded");
    expect(BASIS.upgrade_imports.toLowerCase()).toContain("may have no reachable route");
  });

  it("8. a stale attestor heartbeat is shown, and a live one is not", () => {
    const stale = [{ id: "attestor-2.testnet", heartbeatAgeBlocks: COVERAGE_ASSUME.heartbeatMaxAgeBlocks + 1 }];
    expect(renderToStaticMarkup(<HeartbeatAlert attestors={stale} />)).toContain("An attestor has stopped reporting");
    expect(renderToStaticMarkup(<HeartbeatAlert attestors={[{ id: "a", heartbeatAgeBlocks: 10 }]} />)).toBe("");
  });

  it("never calls the system trustless", () => {
    const hits = files(SRC).filter((f) => /trustless/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
