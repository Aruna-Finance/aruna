import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function keeperKey(account: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.ARUNA_KEEPER_KEY?.trim();
  if (fromEnv) {
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(fromEnv)) throw new Error("ARUNA_KEEPER_KEY must be an ed25519:<base58> private key");
    return fromEnv;
  }
  const p = join(homedir(), ".near-credentials", "testnet", `${account}.json`);
  if (!existsSync(p)) throw new Error(`no key for ${account}: set ARUNA_KEEPER_KEY or add ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}
