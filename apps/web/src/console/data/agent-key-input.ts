// A public key pasted for an agent whose private key lives somewhere else (a CLI, an MCP server, another machine). The vault
// would refuse a malformed key only after the owner had signed and paid gas, so it is checked here first, and the field named.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The bytes a base58 string stands for, or null when it holds a character outside the alphabet. */
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Null when the text is an ed25519 public key (32 bytes, base58); otherwise what is wrong with it. */
export function publicKeyProblem(input: string): string | null {
  const s = input.trim();
  if (s === "") return "Paste the agent's public key.";
  if (!s.startsWith("ed25519:")) return 'The public key must start with "ed25519:".';
  const bytes = base58Decode(s.slice("ed25519:".length));
  if (bytes === null) return "The public key holds a character that is not base58.";
  if (bytes.length !== 32) return `An ed25519 public key is 32 bytes; this one decodes to ${bytes.length}.`;
  return null;
}
