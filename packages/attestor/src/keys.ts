import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function publicKeyOf(seed: Buffer): string {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const raw = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32);
  return "ed25519:" + base58(raw);
}

const signingPath = (account: string) => join(homedir(), ".near-credentials", "aruna-attestors", `${account}.json`);

type Env = Record<string, string | undefined>;

function seedFromEnv(env: Env): Buffer | null {
  const hex = env.ARUNA_ATTESTOR_SIGNING_SEED_HEX?.trim();
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("ARUNA_ATTESTOR_SIGNING_SEED_HEX must be 64 hex characters (a 32-byte ed25519 seed)");
  return Buffer.from(hex, "hex");
}

export function signingSeed(account: string, create = false, env: Env = process.env): Buffer {
  const fromEnv = seedFromEnv(env);
  if (fromEnv) return fromEnv;
  const p = signingPath(account);
  if (existsSync(p)) return Buffer.from(JSON.parse(readFileSync(p, "utf8")).seed_hex, "hex");
  if (!create) throw new Error(`no signing key for ${account} at ${p}: run \`aruna-attestor keygen --attestor ${account}\``);
  const seed = randomBytes(32);
  mkdirSync(join(homedir(), ".near-credentials", "aruna-attestors"), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify({ account_id: account, public_key: publicKeyOf(seed), seed_hex: seed.toString("hex") }), { mode: 0o600 });
  return seed;
}

export function accountKey(account: string, env: Env = process.env): string {
  const fromEnv = env.ARUNA_ATTESTOR_ACCOUNT_KEY?.trim();
  if (fromEnv) {
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(fromEnv)) throw new Error("ARUNA_ATTESTOR_ACCOUNT_KEY must be an ed25519:<base58> private key");
    return fromEnv;
  }
  const p = join(homedir(), ".near-credentials", "testnet", `${account}.json`);
  if (!existsSync(p)) throw new Error(`no account key for ${account}: set ARUNA_ATTESTOR_ACCOUNT_KEY or add ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}

export function assertRegisteredKey(attestor: string, onChain: { signing_key: string } | null, seed: Buffer): void {
  if (!onChain) throw new Error(`${attestor} is not a registered attestor on this registry`);
  const local = publicKeyOf(seed);
  if (onChain.signing_key !== local)
    throw new Error(`the signing key here (${local}) is not the one ${attestor} registered (${onChain.signing_key}); fix the secret or rotate_signing_key`);
}
