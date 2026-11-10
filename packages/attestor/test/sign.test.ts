import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { signingBytes, signReport } from "../src/report.js";

const golden = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/golden/drift-report.json", import.meta.url)), "utf8"));

describe("drift report signing (golden vector shared with contracts/common)", () => {
  it("encodes the report to the golden bytes", () => {
    expect(signingBytes(golden.report).toString("hex")).toBe(golden.signing_bytes_hex);
  });

  it("reproduces the golden signature from the test seed", () => {
    expect(signReport(golden.report, Buffer.from(golden.seed_hex, "hex")).toString("hex")).toBe(golden.signature_hex);
  });

  it("a different nonce gives different bytes", () => {
    expect(signingBytes({ ...golden.report, nonce: golden.report.nonce + 1 }).toString("hex")).not.toBe(golden.signing_bytes_hex);
  });
});

describe("signing key", () => {
  it("derives the golden public key from the golden seed", async () => {
    const { publicKeyOf, base58 } = await import("../src/keys.js");
    expect(publicKeyOf(Buffer.from(golden.seed_hex, "hex"))).toBe("ed25519:" + base58(Buffer.from(golden.public_key_hex, "hex")));
  });
});
