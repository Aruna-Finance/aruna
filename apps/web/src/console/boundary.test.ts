import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// FRONTEND.md non-negotiable 1: the classifier page stays static, keyless and free of wallet code.
// Console code lives in src/console and is reachable only from src/app/console.
const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("console boundary", () => {
  it("is imported only by src/console and src/app/console", () => {
    const offenders = files(SRC)
      .filter((f) => {
        const rel = relative(SRC, f).split(sep).join("/");
        return !rel.startsWith("console/") && !rel.startsWith("app/console/");
      })
      .filter((f) => /(from|import)\s*\(?\s*["']@\/console\//.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("keeps wallet and signing libraries out of the landing and classifier code", () => {
    const banned = /(from|import)\s*\(?\s*["'](near-api-js|@hot-labs\/[^"']*|@near-wallet-selector[^"']*|@near-js\/[^"']*|@aruna\/sdk)["']/;
    const offenders = files(SRC)
      .filter((f) => {
        const rel = relative(SRC, f).split(sep).join("/");
        return !rel.startsWith("console/") && !rel.startsWith("app/console/");
      })
      .filter((f) => banned.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
