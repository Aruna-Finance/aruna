// The keeper's key: the one that signs `set_class` and `lift_freeze` as the registry owner. It comes from
// ARUNA_KEEPER_KEY, else the near-cli-rs legacy keychain, ~/.near-credentials/testnet/<account>.json. On a host,
// prefer a function-call key on the owner account limited to the registry and those two methods, so a leaked key
// cannot move the account's funds or change its keys. It can still rewrite a target's class: guard it as a secret.
// It is never the attestor's key (docs/plans/2026-11-13-2018-feat-hosted-attestor-keeper-plan.md KTD1).
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
