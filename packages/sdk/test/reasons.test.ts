import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTO_DISABLE_REASONS, parseReason, REASONS } from "../src/index.js";

const repo = (p: string) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), "utf8");
const rust = repo("contracts/common/src/reasons.rs");
const contractsDoc = repo("docs/CONTRACTS.md");
const strip = (s: string) => s.replace(/^ARUNA_/, "");

// The Reason enum: `#[serde(rename = "ARUNA_X")] Variant,` pairs.
const variants = new Map([...rust.matchAll(/#\[serde\(rename = "(ARUNA_[A-Z_]+)"\)\]\s*(\w+),/g)].map((m) => [m[2], m[1]]));
// `counts_toward_auto_disable`: matches!(self, Reason::A | Reason::B ...)
const countsBody = rust.match(/fn counts_toward_auto_disable[\s\S]*?matches!\(\s*self,([\s\S]*?)\)/)?.[1] ?? "";
const counted = [...countsBody.matchAll(/Reason::(\w+)/g)].map((m) => strip(variants.get(m[1]) ?? `missing ${m[1]}`));
// docs/CONTRACTS.md: | `ARUNA_X` | yes | ...
const docRows = [...contractsDoc.matchAll(/^\| `(ARUNA_[A-Z_]+)` \| (yes|no)/gm)];

describe("refusal reasons", () => {
  it("the contract's Reason enum was parsed", () => {
    expect(variants.size).toBeGreaterThan(0);
    expect(counted.length).toBeGreaterThan(0);
  });

  it("match the contract's ARUNA_* values exactly, without the prefix", () => {
    expect([...variants.values()].map(strip).sort()).toEqual([...REASONS].sort());
  });

  it("count toward auto-disable exactly where the contract does", () => {
    expect([...counted].sort()).toEqual([...AUTO_DISABLE_REASONS].sort());
  });

  it("match the canonical table in docs/CONTRACTS.md", () => {
    expect(docRows.map((m) => strip(m[1])).sort()).toEqual([...REASONS].sort());
    expect(docRows.filter((m) => m[2] === "yes").map((m) => strip(m[1])).sort()).toEqual([...AUTO_DISABLE_REASONS].sort());
  });

  it("parseReason maps contract values and refuses unknown ones", () => {
    expect(parseReason("ARUNA_CLASS_STALE")).toBe("CLASS_STALE");
    expect(() => parseReason("ARUNA_SOMETHING_NEW")).toThrow(/unknown refusal reason/);
    expect(() => parseReason("CLASS_STALE")).toThrow();
  });
});
