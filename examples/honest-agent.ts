// An honest agent: refreshes the target's class, then makes one swap within its policy.
//   node examples/honest-agent.ts [amount-in-NEAR, default 0.1]
// Expected: class local_upgradeable cached, spend Allowed, cb_settle returns true, exposure recorded.

import { agentAccount, agentKey, explorer, fmt, near, send, SWAP, VAULT, view } from "./lib.ts";
import type { Agent } from "./lib.ts";

const amount = near(process.argv[2] ?? "0.1");
// The swap fixture keeps a 0.5% fee; the policy allows 1% slippage. Ask for at least 99.5% back.
const minOut = ((BigInt(amount) * 9_950n) / 10_000n).toString();
const agent = agentAccount("honest");
const key = agentKey("honest").getPublicKey().toString();

console.log(`vault  ${VAULT}\nagent  honest  ${key}\n`);

const refreshed = await send(agent, "refresh_class", { target: SWAP });
console.log(`1. refresh_class(${SWAP})`);
console.log(`   cached: ${JSON.stringify(refreshed.value)}`);
console.log(`   tx ${explorer(refreshed.tx)}\n`);

const spent = await send(agent, "spend", { adapter: "swap", target: SWAP, amount, min_amount_out: minOut });
console.log(`2. spend swap ${fmt(amount)} on ${SWAP}, min_amount_out ${fmt(minOut)}`);
for (const e of spent.events) console.log(`   event ${e.event}: ${JSON.stringify(e.data[0])}`);
console.log(`   cb_settle returned ${JSON.stringify(spent.value)}`);
console.log(`   tx ${explorer(spent.tx)}\n`);

const a = await view<Agent>("get_agent", { public_key: key });
const exposure = await view<{ amount: string; class_at_record: string } | null>("get_exposure", { target: SWAP });
console.log(`3. state after settlement`);
console.log(`   agent status ${a.status}, spent today ${fmt(a.budget.spent_today)}, reserved ${fmt(a.budget.reserved)}`);
console.log(`   exposure to ${SWAP}: ${exposure ? `${fmt(exposure.amount)} recorded as ${exposure.class_at_record}` : "none"}`);
if (spent.value !== true) process.exit(1);
