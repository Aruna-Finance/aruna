import { describe, expect, it } from "vitest";
import { keeperKey } from "../src/keys.js";

// An account no keychain on any machine holds, so the file fallback always misses.
const NOBODY = "no-such-keeper-for-tests.testnet";

describe("the keeper's key", () => {
  it("is read from ARUNA_KEEPER_KEY before any file", () => {
    // A format check only: the value is no key, and short enough that scripts/secret-scan.sh does not match it.
    expect(keeperKey(NOBODY, { ARUNA_KEEPER_KEY: "ed25519:FakeKeyForTests" })).toBe("ed25519:FakeKeyForTests");
  });

  it("rejects a value that is not an ed25519 private key string", () => {
    expect(() => keeperKey(NOBODY, { ARUNA_KEEPER_KEY: "secp256k1:abc" })).toThrow(/ed25519/);
  });

  it("names both places to put it when neither has it", () => {
    expect(() => keeperKey(NOBODY, {})).toThrow(/ARUNA_KEEPER_KEY/);
  });
});
