import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(import.meta.dirname, "..", f), "utf8");

describe("what a Railway deploy reads from this folder", () => {
  it("has a Dockerfile without a VOLUME instruction, which Railway rejects when it validates the file", () => {
    const instructions = read("Dockerfile")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .map((l) => l.trim().split(/\s+/)[0]?.toUpperCase());
    expect(instructions).not.toContain("VOLUME");
  });

  it("names the Dockerfile relative to the folder, so the folder can be the service's Root Directory", () => {
    const config = JSON.parse(read("railway.json")) as { build: { builder: string; dockerfilePath: string } };
    expect(config.build).toEqual({ builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
  });

  it("reads only files inside this folder when it builds", () => {
    const copies = read("Dockerfile")
      .split("\n")
      .filter((l) => /^COPY\s/i.test(l.trim()) && !l.includes("--from="));
    for (const line of copies) expect(line).not.toMatch(/\.\.\/|\bpackages\//);
  });
});
