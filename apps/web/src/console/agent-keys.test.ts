import { describe, expect, it } from "vitest";
import { browserStore, exportText, forgetKey, generateAgentKey, keyInThisBrowser, keyMatches, KEY_LABEL, listKeys, loadKey, saveKey, type KeyStore } from "./agent-keys";

function memory(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("agent keys", () => {
  it("generates a keypair whose secret matches its public key", () => {
    const k = generateAgentKey();
    expect(k.publicKey).toMatch(/^ed25519:/);
    expect(k.secret).toMatch(/^ed25519:/);
    expect(keyMatches(k)).toBe(true);
    expect(keyMatches({ publicKey: k.publicKey, secret: generateAgentKey().secret })).toBe(false);
  });
  it("stores and loads a key under its vault and network", () => {
    const s = memory();
    const k = generateAgentKey();
    expect(saveKey(s, { network: "testnet", vault: "v.testnet", ...k })).toBe(true);
    expect(loadKey(s, "testnet", "v.testnet", k.publicKey)).toEqual(k);
  });
  it("never returns a key for another network or another vault", () => {
    const s = memory();
    const k = generateAgentKey();
    saveKey(s, { network: "testnet", vault: "v.testnet", ...k });
    expect(loadKey(s, "mainnet", "v.testnet", k.publicKey)).toBeNull();
    expect(loadKey(s, "testnet", "other.testnet", k.publicKey)).toBeNull();
    expect(listKeys(s, "mainnet", "v.testnet")).toEqual([]);
    expect(listKeys(s, "testnet", "v.testnet")).toEqual([k.publicKey]);
  });
  it("refuses to store a secret that is not the key's private half", () => {
    const s = memory();
    const a = generateAgentKey();
    expect(saveKey(s, { network: "testnet", vault: "v", publicKey: a.publicKey, secret: generateAgentKey().secret })).toBe(false);
    expect(s.data.size).toBe(0);
  });
  it("ignores a stored value that was tampered with", () => {
    const s = memory();
    const k = generateAgentKey();
    saveKey(s, { network: "testnet", vault: "v", ...k });
    for (const key of s.data.keys()) s.data.set(key, "garbage");
    expect(loadKey(s, "testnet", "v", k.publicKey)).toBeNull();
  });
  it("reports a blocked store instead of throwing", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const blocked: KeyStore = { length: 0, key: () => null, getItem: boom, setItem: boom, removeItem: boom };
    const k = generateAgentKey();
    expect(saveKey(blocked, { network: "testnet", vault: "v", ...k })).toBe(false);
    expect(loadKey(blocked, "testnet", "v", k.publicKey)).toBeNull();
    expect(listKeys(blocked, "testnet", "v")).toEqual([]);
    expect(() => forgetKey(blocked, "testnet", "v", k.publicKey)).not.toThrow();
    expect(saveKey(null, { network: "testnet", vault: "v", ...k })).toBe(false);
  });
  it("forgets a key", () => {
    const s = memory();
    const k = generateAgentKey();
    saveKey(s, { network: "testnet", vault: "v", ...k });
    forgetKey(s, "testnet", "v", k.publicKey);
    expect(loadKey(s, "testnet", "v", k.publicKey)).toBeNull();
  });
  it("exports the label, network, vault and the secret", () => {
    const k = generateAgentKey();
    const t = exportText({ network: "testnet", vault: "v.testnet", ...k });
    expect(t).toContain(KEY_LABEL);
    expect(t).toContain("v.testnet");
    expect(t).toContain(k.secret);
  });
  it("marks an agent whose key is not held here (AE5)", () => {
    expect(keyInThisBrowser(["ed25519:a"], "ed25519:b")).toBe(false);
    expect(keyInThisBrowser(["ed25519:a"], "ed25519:a")).toBe(true);
  });
  it("has no store outside a browser", () => {
    expect(browserStore()).toBeNull();
  });
});
