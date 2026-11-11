import { KeyPair } from "near-api-js";
import type { KeyPairString } from "near-api-js";

// Browser agent keys (plan U6, R18, R23, KTD7). An ed25519 keypair made in the tab, kept in localStorage under
// network + vault + public key. The private key never leaves this browser, except through the export the user asks
// for. Clearing site data loses it, and an agent whose key is absent is then shown as "key not in this browser".

export const KEY_LABEL = "testnet agent key, limited to this vault";

/** The part of localStorage this file uses, so tests need no browser. */
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;

const PREFIX = "aruna.agentkey";
const slot = (network: string, vault: string, publicKey: string) => `${PREFIX}|${network}|${vault}|${publicKey}`;

export interface AgentKey {
  publicKey: string;
  /** "ed25519:..." private key. Treat as a secret. */
  secret: string;
}

export function generateAgentKey(): AgentKey {
  const kp = KeyPair.fromRandom("ed25519");
  return { publicKey: kp.getPublicKey().toString(), secret: kp.toString() };
}

/** Whether a secret string really is the private half of the public key. */
export function keyMatches(k: AgentKey): boolean {
  try {
    return KeyPair.fromString(k.secret as KeyPairString).getPublicKey().toString() === k.publicKey;
  } catch {
    return false;
  }
}

/** The browser's storage, or null when it is blocked (private window, cleared data). Every access is guarded. */
export function browserStore(): KeyStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** True when the key was written. False means the browser refused, so the key must be exported now or it is lost. */
export function saveKey(store: KeyStore | null, o: { network: string; vault: string } & AgentKey): boolean {
  if (!store || !keyMatches(o)) return false;
  try {
    store.setItem(slot(o.network, o.vault, o.publicKey), o.secret);
    return true;
  } catch {
    return false;
  }
}

export function loadKey(store: KeyStore | null, network: string, vault: string, publicKey: string): AgentKey | null {
  if (!store) return null;
  try {
    const secret = store.getItem(slot(network, vault, publicKey));
    return secret && keyMatches({ publicKey, secret }) ? { publicKey, secret } : null;
  } catch {
    return null;
  }
}

/** Public keys this browser holds a private key for, on this network and vault only. */
export function listKeys(store: KeyStore | null, network: string, vault: string): string[] {
  if (!store) return [];
  const head = `${PREFIX}|${network}|${vault}|`;
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(head)) out.push(k.slice(head.length));
    }
  } catch {
    return [];
  }
  return out;
}

export function forgetKey(store: KeyStore | null, network: string, vault: string, publicKey: string): void {
  try {
    store?.removeItem(slot(network, vault, publicKey));
  } catch {
    /* nothing to do */
  }
}

/** Text for the download. Says what the key can do and where it works, so a file found later is not a mystery. */
export function exportText(o: { vault: string; network: string } & AgentKey): string {
  return [
    `# ${KEY_LABEL}`,
    `# network: ${o.network}`,
    `# vault: ${o.vault}`,
    `# public key: ${o.publicKey}`,
    "# Function-call key on the vault. It can call spend on this vault only, within the policy set for it.",
    o.secret,
    "",
  ].join("\n");
}

/** Whether this browser can sign for the agent (R23). Separate from whether the agent exists on chain. */
export const keyInThisBrowser = (held: readonly string[], publicKey: string) => held.includes(publicKey);
