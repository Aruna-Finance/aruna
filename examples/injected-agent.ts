// A prompt-injected agent. It has the same policy as the honest one; a poisoned tool result tells it
// to move funds out. The vault refuses every attempt, records each refusal, and pauses the agent once
// the weighted refusals reach AUTO_DISABLE_THRESHOLD (24) within 1,200 blocks (docs/DECISIONS.md D-19).
//   node examples/injected-agent.ts
// Expected: five refusals that RETURN (not panic), agent_auto_disabled on the fifth, then even an
// in-policy swap is refused with ARUNA_AGENT_AUTO_DISABLED. Nothing leaves the vault.
// To run it again: node examples/resume-agent.ts injected (the owner, not the operator).
//
// The injection is simulated: the text below stands in for a tool result an attacker controls.

import { AgentVault, nearApiTransport } from "@aruna/sdk/vault";
import { agentAccount, agentKey, explorer, fmt, RPC, SWAP, VAULT, view } from "./lib.ts";
import type { Agent } from "./lib.ts";
import { injectedScenario, POISONED_TOOL_RESULT } from "./scenarios.ts";

const agent = agentAccount("injected");
const key = agentKey("injected").getPublicKey().toString();
const balance = BigInt((await agent.provider.viewAccount({ accountId: VAULT })).amount);

console.log(`vault  ${VAULT}  balance ${fmt(balance)}\nagent  injected  ${key}\n`);
console.log(`tool result the agent read:\n  ${POISONED_TOOL_RESULT.replace(/\n/g, "\n  ")}\n`);

const before = await view<Agent>("get_agent", { public_key: key });
if (before.status !== "Active") {
  console.log(`agent is ${before.status}${before.auto_disabled ? " (auto-disabled)" : ""}: run \`node examples/resume-agent.ts injected\` first`);
  process.exit(1);
}

// What the injected agent tries, in order: the same list the console's playground runs (scenarios.ts).
const attempts = injectedScenario({ swap: SWAP, balance: balance.toString() });

// Through the SDK, as the agent would call it. A refusal resolves; it is never retried.
const vault = new AgentVault({ vaultId: VAULT, transport: nearApiTransport({ signerId: VAULT, privateKey: agentKey("injected").toString(), rpcUrl: RPC }) });
await vault.refreshClass(SWAP);
let n = 0;
for (const { intent, action } of attempts) {
  const r = await vault.spend(action);
  console.log(`${++n}. ${intent}: spend(${action.target}, ${fmt(action.amount)})`);
  console.log(`   ${r.ok ? "settled" : `Blocked ${r.reason}`}  class ${r.ok ? "-" : (r.targetClass ?? "none cached")}`);
  console.log(`   tx ${explorer(r.tx)}`);
}

const after = await view<Agent>("get_agent", { public_key: key });
const left = BigInt((await agent.provider.viewAccount({ accountId: VAULT })).amount);
const weighted = after.refusals.reduce((s, [, w]) => s + w, 0);
console.log(`\nagent status ${after.status}, auto_disabled ${after.auto_disabled}, weighted refusals ${weighted}`);
console.log(`vault balance ${fmt(left)} (before ${fmt(balance)}; the difference is gas, paid by the vault)`);
console.log(`the key is still on the vault, but every spend it signs is refused until the owner resumes it`);
if (!after.auto_disabled) process.exit(1);
