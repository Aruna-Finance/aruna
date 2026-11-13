import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountKey, assertRegisteredKey, publicKeyOf, signingSeed } from "../src/keys.js";
import { stateDir } from "../src/state.js";

const golden = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/golden/drift-report.json", import.meta.url)), "utf8"));
const goldenSeed = Buffer.from(golden.seed_hex, "hex");
// An account no keychain on any machine holds, so the file fallback always misses.
const NOBODY = "no-such-attestor-for-tests.testnet";

describe("signing seed from the environment", () => {
  it("is read from ARUNA_ATTESTOR_SIGNING_SEED_HEX before any file", () => {
    expect(signingSeed(NOBODY, false, { ARUNA_ATTESTOR_SIGNING_SEED_HEX: golden.seed_hex }).equals(goldenSeed)).toBe(true);
  });

  it("is never replaced by a new one when the environment supplies it, even for keygen", () => {
    expect(signingSeed(NOBODY, true, { ARUNA_ATTESTOR_SIGNING_SEED_HEX: golden.seed_hex }).equals(goldenSeed)).toBe(true);
  });

  it("rejects a value that is not 32 bytes of hex", () => {
    expect(() => signingSeed(NOBODY, false, { ARUNA_ATTESTOR_SIGNING_SEED_HEX: "abc" })).toThrow(/64 hex characters/);
    expect(() => signingSeed(NOBODY, false, { ARUNA_ATTESTOR_SIGNING_SEED_HEX: "z".repeat(64) })).toThrow(/64 hex characters/);
  });

  it("stops, without creating one, when neither the environment nor a file has it", () => {
    expect(() => signingSeed(NOBODY, false, {})).toThrow(/no signing key/);
  });
});

describe("account key from the environment", () => {
  it("is read from ARUNA_ATTESTOR_ACCOUNT_KEY before the keychain", () => {
    // A format check only: the value is no key, and short enough that scripts/secret-scan.sh does not match it.
    expect(accountKey(NOBODY, { ARUNA_ATTESTOR_ACCOUNT_KEY: "ed25519:FakeKeyForTests" })).toBe("ed25519:FakeKeyForTests");
  });

  it("rejects a value that is not an ed25519 private key string", () => {
    expect(() => accountKey(NOBODY, { ARUNA_ATTESTOR_ACCOUNT_KEY: "secp256k1:abc" })).toThrow(/ed25519/);
  });

  it("names both places to put it when neither has it", () => {
    expect(() => accountKey(NOBODY, {})).toThrow(/ARUNA_ATTESTOR_ACCOUNT_KEY/);
  });
});

describe("registered key check at start", () => {
  it("passes when the seed derives the key the registry holds", () => {
    expect(() => assertRegisteredKey(NOBODY, { signing_key: publicKeyOf(goldenSeed) }, goldenSeed)).not.toThrow();
  });

  it("stops when the registry holds another key", () => {
    const other = Buffer.alloc(32, 7);
    expect(() => assertRegisteredKey(NOBODY, { signing_key: publicKeyOf(other) }, goldenSeed)).toThrow(/rotate_signing_key/);
  });

  it("stops when the account is not a registered attestor", () => {
    expect(() => assertRegisteredKey(NOBODY, null, goldenSeed)).toThrow(/not a registered attestor/);
  });
});

describe("state directory", () => {
  it("follows ARUNA_ATTESTOR_STATE_DIR, else the home directory", () => {
    expect(stateDir({ ARUNA_ATTESTOR_STATE_DIR: "/data" })).toBe("/data");
    expect(stateDir({})).toBe(join(homedir(), ".aruna-attestor"));
  });
});
