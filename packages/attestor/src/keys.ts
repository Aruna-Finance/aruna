// Keys. The attestor's ACCOUNT key (pays for and sends transactions) comes from the near-cli-rs
// legacy keychain, ~/.near-credentials/testnet/<account>.json. Its SIGNING key (signs drift reports)
// is separate (docs/DECISIONS.md D-30) and lives in ~/.near-credentials/aruna-attestors/<account>.json.
// Neither is ever in the repo.
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

export function signingSeed(account: string, create = false): Buffer {
  const p = signingPath(account);
  if (existsSync(p)) return Buffer.from(JSON.parse(readFileSync(p, "utf8")).seed_hex, "hex");
  if (!create) throw new Error(`no signing key for ${account} at ${p}: run \`aruna-attestor keygen --attestor ${account}\``);
  const seed = randomBytes(32);
  mkdirSync(join(homedir(), ".near-credentials", "aruna-attestors"), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify({ account_id: account, public_key: publicKeyOf(seed), seed_hex: seed.toString("hex") }), { mode: 0o600 });
  return seed;
}

export function accountKey(account: string): string {
  const p = join(homedir(), ".near-credentials", "testnet", `${account}.json`);
  if (!existsSync(p)) throw new Error(`no legacy keychain entry for ${account} at ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}
