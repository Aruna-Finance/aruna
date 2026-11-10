#!/usr/bin/env node
// Helpers for deploy.sh. Never touches a private key.
//   node tools.mjs hash <file.wasm>          base58 sha256: the global contract code hash
//   node tools.mjs random-pk                 a fresh ed25519 public key; its private half is discarded
//   node tools.mjs full-access-keys <id>     full-access public keys on a testnet account, comma-separated
//   node tools.mjs exists <id>               exit 0 if the testnet account exists
//   node tools.mjs class-args <id>           classify a testnet account and print registry set_class args:
//                                            evidence_hash is the hex sha256 of JSON.stringify(evidence)
//   node tools.mjs view <id> <method> [json] a testnet view call, result printed as JSON
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { classify } from "@aruna/classifier-core";
import { createFetchReader } from "@aruna/rpc";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
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

const [cmd, arg] = process.argv.slice(2);
const reader = createFetchReader({ network: "testnet" });
if (cmd === "hash") {
  console.log(base58(createHash("sha256").update(readFileSync(arg)).digest()));
} else if (cmd === "random-pk") {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  console.log("ed25519:" + base58(raw));
} else if (cmd === "full-access-keys") {
  const { keys } = await reader.viewAccessKeyList(arg);
  console.log(keys.filter((k) => k.permission === "full_access").map((k) => k.publicKey).join(","));
} else if (cmd === "exists") {
  process.exit((await reader.viewAccount(arg)).exists ? 0 : 1);
} else if (cmd === "class-args") {
  const { class: cls, evidence } = await classify(arg, reader);
  const evidence_hash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  console.error(JSON.stringify({ class: cls, evidence }, null, 2));
  console.log(JSON.stringify({ target: arg, class: cls, evidence_hash }));
} else if (cmd === "view") {
  const [method, json] = process.argv.slice(4);
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: arg, method_name: method, args_base64: Buffer.from(json ?? "{}").toString("base64") },
    }),
  }).then((r) => r.json());
  if (!res.result || res.result.error) throw new Error(JSON.stringify(res.error ?? res.result));
  console.log(Buffer.from(res.result.result).toString() || "null");
} else {
  console.error("usage: tools.mjs hash|random-pk|full-access-keys|exists|class-args|view");
  process.exit(2);
}
