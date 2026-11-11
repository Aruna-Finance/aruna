// Shared pieces of the two agent examples. Testnet only.
//
// An agent is a function-call key on the vault account, added by the vault itself. It can call only
// `spend` and `refresh_class` on the vault, so an agent transaction is signed by the vault account
// with the agent's key. Agent private keys live in ~/.near-credentials/aruna-agents/, never the repo.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import type { KeyPairString } from "near-api-js";

export const PARENT = process.env.ARUNA_TESTNET_ACCOUNT ?? "arunafi.testnet";
if (!PARENT.endsWith(".testnet")) throw new Error(`refusing: ${PARENT} is not a .testnet account`);
export const VAULT = process.env.ARUNA_VAULT ?? `demo2.factory.${PARENT}`;
export const SWAP = `swap.${PARENT}`;
export const OWNER = `demo-client.${PARENT}`;
export const OPERATOR = `demo-company.${PARENT}`;
export const RPC = process.env.ARUNA_RPC_TESTNET?.split(",")[0] ?? "https://rpc.testnet.fastnear.com";

export const provider = new JsonRpcProvider({ url: RPC });
export const NEAR = 10n ** 24n;
export const near = (n: string): string => {
  const [whole, frac = ""] = n.split(".");
  return (BigInt(whole) * NEAR + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
};
export const fmt = (yocto: string | bigint): string => {
  const v = BigInt(yocto);
  const frac = (v % NEAR).toString().padStart(24, "0").slice(0, 4);
  return `${v / NEAR}.${frac} NEAR`;
};

/** Prepaid gas on an agent call. The node reserves it from the key's allowance at a pessimistic gas
 * price, so it is kept close to what `spend` needs (docs/NEAR-FACTS.md §10). */
export const AGENT_GAS = 60n * 10n ** 12n;

const KEY_DIR = join(homedir(), ".near-credentials", "aruna-agents", VAULT);

export function agentKeyPath(label: string): string {
  return join(KEY_DIR, `${label}.json`);
}

/** Loads the agent's key pair, creating it on first use. */
export function agentKey(label: string, create = false): KeyPair {
  const path = agentKeyPath(label);
  if (existsSync(path)) return KeyPair.fromString(JSON.parse(readFileSync(path, "utf8")).private_key as KeyPairString);
  if (!create) throw new Error(`no key for agent "${label}" at ${path}: run \`node examples/add-agents.ts\` first`);
  const kp = KeyPair.fromRandom("ed25519");
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ account_id: VAULT, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  return kp;
}

/** A key from the near-cli-rs legacy keychain (~/.near-credentials/testnet). Stays in this process. */
export function legacyKey(accountId: string): string {
  const path = join(homedir(), ".near-credentials", "testnet", `${accountId}.json`);
  if (!existsSync(path)) throw new Error(`no legacy keychain entry for ${accountId} at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")).private_key as string;
}

/** An account signing with a key from the near-cli-rs legacy keychain. */
export function legacyAccount(accountId: string): Account {
  return new Account(accountId, provider, legacyKey(accountId) as KeyPairString);
}

/** The vault account, signing with one agent's function-call key. */
export function agentAccount(label: string): Account {
  return new Account(VAULT, provider, agentKey(label).toString());
}

export interface Event {
  event: string;
  data: Record<string, unknown>[];
}

export interface Sent {
  tx: string;
  /** The transaction's final return value, decoded from JSON. */
  value: unknown;
  events: Event[];
}

/** Sends one function call and waits for every receipt, including callbacks. */
export async function send(account: Account, methodName: string, args: Record<string, unknown>, deposit = "0", gas = AGENT_GAS): Promise<Sent> {
  const res = await account.callFunctionRaw({ contractId: VAULT, methodName, args, deposit: BigInt(deposit), gas, waitUntil: "FINAL" });
  const events: Event[] = [];
  for (const r of res.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      const e = JSON.parse(log.slice("EVENT_JSON:".length));
      if (e.standard === "aruna") events.push({ event: e.event, data: e.data });
    }
  }
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure !== undefined) throw new Error(`${methodName} failed: ${JSON.stringify(status.Failure)}`);
  const raw = Buffer.from(status.SuccessValue ?? "", "base64").toString();
  return { tx: res.transaction.hash, value: raw ? JSON.parse(raw) : null, events };
}

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId: VAULT, method, args })) as T;
}

export interface Agent {
  label: string;
  status: "Active" | "Paused" | "Revoked";
  auto_disabled: boolean;
  budget: { spent_today: string; reserved: string; day_index: number };
  refusals: [number, number][];
}

export const explorer = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;
