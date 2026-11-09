#!/usr/bin/env node
// Records what the RpcReader returns for each account, so tests can replay real testnet answers
// offline. Usage: node snapshot.mjs <account>... [--label before|after]
import { mkdir, writeFile } from "node:fs/promises";
import { classify } from "@aruna/classifier-core";
import { createFetchReader } from "@aruna/rpc";

const args = process.argv.slice(2);
const labelAt = args.indexOf("--label");
const label = labelAt >= 0 ? args.splice(labelAt, 2)[1] : null;
const reader = createFetchReader({ network: "testnet" });
await mkdir(new URL("./snapshots/", import.meta.url), { recursive: true });

for (const accountId of args) {
  const viewAccount = await reader.viewAccount(accountId);
  const viewAccessKeyList = await reader.viewAccessKeyList(accountId);
  const viewCode = await reader.viewCode(accountId);
  const snapshot = { accountId, network: "testnet", recordedAt: new Date().toISOString(), viewAccount, viewAccessKeyList, viewCode };
  const c = await classify(accountId, reader);
  snapshot.classifiedLive = { class: c.class, basis: c.evidence.mutabilityBasis };
  const name = `${accountId.split(".")[0]}${label ? `-${label}` : ""}.json`;
  await writeFile(new URL(`./snapshots/${name}`, import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`${accountId}: ${c.class} (${c.evidence.mutabilityBasis}) -> snapshots/${name}`);
}
