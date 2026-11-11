import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POOL_METHODS } from "../src/generated/pool.js";
import { REGISTRY_METHODS } from "../src/generated/registry.js";
import { VAULT_METHODS } from "../src/generated/vault.js";

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

describe("types generated from the contract ABIs (docs/SDK.md Type generation)", () => {
  it("the committed generated files equal what the committed ABIs produce", () => {
    expect(() => execFileSync("node", [repo("scripts/gen-abi-types.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it.each([
    ["vault", VAULT_METHODS],
    ["registry", REGISTRY_METHODS],
    ["pool", POOL_METHODS],
  ] as const)("%s: the generated method list is the ABI's function list", (name, methods) => {
    const abi = JSON.parse(readFileSync(repo(`contracts/${name}/res/aruna_${name}.abi.json`), "utf8"));
    expect([...methods]).toEqual(abi.body.functions.map((f: { name: string }) => f.name).sort((a: string, b: string) => a.localeCompare(b)));
  });

  it("no callback method is reachable from an agent key's method list", () => {
    const vault = JSON.parse(readFileSync(repo("contracts/vault/res/aruna_vault.abi.json"), "utf8"));
    const callbacks = vault.body.functions.map((f: { name: string }) => f.name).filter((n: string) => n.startsWith("cb_"));
    expect(callbacks.length).toBeGreaterThan(0);
    const clients = readFileSync(new URL("../src/vault/clients.ts", import.meta.url), "utf8");
    for (const cb of callbacks) expect(clients).not.toContain(`"${cb}"`);
  });
});
