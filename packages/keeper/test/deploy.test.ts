import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = (f: string) => readFileSync(join(import.meta.dirname, "..", f), "utf8");
const root = (f: string) => readFileSync(join(import.meta.dirname, "../../..", f), "utf8");
const instructions = (dockerfile: string) =>
  dockerfile
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .map((l) => l.trim().split(/\s+/)[0]?.toUpperCase());

describe("what a Railway deploy reads for the keeper service", () => {
  it("has a Dockerfile without a VOLUME instruction, which Railway rejects when it validates the file", () => {
    expect(instructions(here("Dockerfile"))).not.toContain("VOLUME");
  });

  it("names its Dockerfile by its path from the repository root, the build context, and restarts always", () => {
    const config = JSON.parse(here("railway.json")) as { build: { builder: string; dockerfilePath: string }; deploy: { restartPolicyType: string } };
    expect(config.build).toEqual({ builder: "DOCKERFILE", dockerfilePath: "packages/keeper/Dockerfile" });
    expect(config.deploy.restartPolicyType).toBe("ALWAYS");
  });

  it("builds from the repository root, whose .dockerignore keeps every .env out of the image", () => {
    const ignored = root(".dockerignore").split("\n").map((l) => l.trim());
    expect(ignored).toContain(".env");
    expect(ignored).toContain("**/.env");
  });
});
