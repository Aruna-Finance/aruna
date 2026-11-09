#!/usr/bin/env node
// The invisible drift case (docs/TESTING.md): the owner of a global contract redeploys it, no
// transaction touches the user account, and the field most monitoring watches never changes.
//
//   node fixtures/drift-demo.mjs                 read-only: observe fx-guser.arunafi.testnet now
//   ARUNA_TESTNET_ACCOUNT=you.testnet node fixtures/drift-demo.mjs --redeploy
//       flips fx-gowner.<you> between v1 and v2 and shows fx-guser.<you> before and after.
//       Run fixtures/deploy.sh under the same account first. Testnet only; your keys stay in
//       the near-cli-rs keychain.
import { execFileSync } from "node:child_process";
import { classify } from "@aruna/classifier-core";
import { createFetchReader } from "@aruna/rpc";

const RPC = "https://rpc.testnet.fastnear.com";
const redeploy = process.argv.includes("--redeploy");
const parent = redeploy ? process.env.ARUNA_TESTNET_ACCOUNT : "arunafi.testnet";
if (!parent || !parent.endsWith(".testnet")) {
  console.error("--redeploy needs ARUNA_TESTNET_ACCOUNT set to a .testnet account (testnet only)");
  process.exit(1);
}
const owner = `fx-gowner.${parent}`;
const user = `fx-guser.${parent}`;
const reader = createFetchReader({ network: "testnet" });
const dir = new URL(".", import.meta.url);

async function rpc(params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "drift", method: "query", params: { finality: "final", ...params } }),
  });
  const body = await r.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

/** What the user account looks like through each channel. */
async function observe() {
  const account = await rpc({ request_type: "view_account", account_id: user });
  const code = await rpc({ request_type: "view_code", account_id: user });
  const call = await rpc({ request_type: "call_function", account_id: user, method_name: "version", args_base64: "" });
  const c = await classify(user, reader);
  return {
    block: account.block_height,
    monitored: account.code_hash,
    resolved: code.hash,
    version: JSON.parse(Buffer.from(call.result).toString()),
    class: c.class,
  };
}

function show(label, o) {
  console.log(`${label.padEnd(7)} block ${o.block}`);
  console.log(`        view_account.code_hash  ${o.monitored}   <- the field most monitoring watches`);
  console.log(`        view_code hash          ${o.resolved}   <- the code that actually runs`);
  console.log(`        version()               ${o.version}`);
  console.log(`        class                   ${o.class}`);
}

const before = await observe();
show("now", before);
if (!redeploy) {
  console.log(`\nRead-only. To watch it change, deploy your own pair and pass --redeploy (see fixtures/README.md).`);
  process.exit(0);
}

const next = before.version === "v1" ? "v2" : "v1";
const wasm = new URL(`wasm/${next}/versioned.wasm`, dir).pathname;
console.log(`\n${owner} redeploys ${next} by account id. No transaction touches ${user}.`);
execFileSync(
  "near",
  ["contract", "deploy-as-global", "use-file", wasm, "as-global-account-id", owner, "network-config", "testnet", "sign-with-legacy-keychain", "send"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

let after = before;
for (let i = 0; i < 30 && after.version === before.version; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  after = await observe();
}
show("after", after);
console.log("");
console.log(`view_account.code_hash changed:  ${before.monitored !== after.monitored ? "YES" : "no  <- a monitor keyed on this field saw nothing"}`);
console.log(`view_code hash changed:          ${before.resolved !== after.resolved ? "YES" : "no"}`);
console.log(`executed behaviour changed:      ${before.version !== after.version ? `YES (${before.version} -> ${after.version})` : "no"}`);
console.log(`blocks until the new code ran:   ${after.block - before.block} (upper bound; includes polling)`);

if (process.env.ARUNA_RECORD === "1") {
  execFileSync("node", [new URL("snapshot.mjs", dir).pathname, user, "--label", `after-${next}`], { stdio: "inherit" });
}
