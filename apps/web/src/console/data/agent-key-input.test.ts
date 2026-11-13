import { describe, expect, it } from "vitest";
import { mcpAgentCommand } from "./agent-connect";
import { base58Decode, publicKeyProblem } from "./agent-key-input";

const REAL = "ed25519:HggBZpTLU4HJ2pEHFfVa2ugvxEbVtrKzyTGSfC3oqiFs";

describe("pasted public key", () => {
  it("accepts a real ed25519 public key and ignores surrounding spaces", () => {
    expect(publicKeyProblem(REAL)).toBeNull();
    expect(publicKeyProblem(`  ${REAL}\n`)).toBeNull();
  });
  it("names what is wrong, before anything is signed", () => {
    expect(publicKeyProblem("")).toMatch(/Paste/);
    expect(publicKeyProblem("secp256k1:abc")).toMatch(/start with "ed25519:"/);
    expect(publicKeyProblem("ed25519:0OIl")).toMatch(/not base58/);
    expect(publicKeyProblem("ed25519:abc")).toMatch(/32 bytes; this one decodes to/);
    expect(publicKeyProblem(REAL.slice(0, -2))).toMatch(/32 bytes/);
  });
  it("decodes base58 with leading ones as leading zero bytes", () => {
    expect(Array.from(base58Decode("112")!)).toEqual([0, 0, 1]);
    expect(base58Decode("0")).toBeNull();
  });
});

describe("agent connection command", () => {
  it("names the vault and the key file, as the MCP server's README does", () => {
    const c = mcpAgentCommand("v.factory2.arunafi.testnet");
    expect(c).toContain("ARUNA_AGENT_VAULT=v.factory2.arunafi.testnet");
    expect(c).toContain("ARUNA_AGENT_KEY_FILE=/path/to/agent-key.json");
    expect(c.endsWith("node packages/mcp/dist/index.js")).toBe(true);
  });
});
