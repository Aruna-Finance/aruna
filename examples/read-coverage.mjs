// Keyless: reads the testnet coverage stack through @aruna/sdk/coverage. No account, no key.
//   node examples/read-coverage.mjs
import { fetchViewTransport, Pool, Registry } from "@aruna/sdk/coverage";

const PARENT = process.env.ARUNA_TESTNET_ACCOUNT ?? "arunafi.testnet";
const transport = fetchViewTransport({ network: "testnet" });
const registry = new Registry({ registry: `registry2.${PARENT}`, transport });
const pool = new Pool({ pool: `pool2.${PARENT}`, transport });
const target = `drift-target.${PARENT}`;

const cls = await registry.classOf(target);
console.log(`class of ${target}: ${cls?.class}, resolved hash on record ${cls?.resolved_code_hash}`);
const rep = await registry.latestReport(target);
console.log(`latest drift report: #${rep?.id} ${rep?.state}, changed_at_block ${rep?.report.changed_at_block}`);
const book = await pool.book("near");
console.log(`pool NEAR book: capital ${book.capital}, limits sold ${book.total_limits}`);
for (const c of await pool.coverages({ vault: `demo4.factory2.${PARENT}` })) {
  console.log(`coverage #${c.id} (${typeof c.token === "string" ? c.token : c.token.ft}): limit ${c.limit}, premium ${c.premium_paid}, paid out ${c.paid_out}`);
}
