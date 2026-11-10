// An honest agent, written against @aruna/sdk the way an agent developer would (docs/SDK.md
// "Integration example"): decide, simulate when the vault supports it, spend, log refusals.
//   node examples/honest-agent.ts [amount-in-NEAR, default 0.1]
// Expected: the spend settles, exposure is recorded. A stale class is refreshed by the SDK, once.
import { AgentVault, nearApiTransport } from "@aruna/sdk/vault";
import { agentKey, fmt, near, RPC, SWAP, VAULT } from "./lib.ts";

const amount = near(process.argv[2] ?? "0.1");
// The swap target keeps a 0.5% fee; the policy allows 1% slippage. Ask for at least 99.5% back.
const minOut = ((BigInt(amount) * 9_950n) / 10_000n).toString();
const key = agentKey("honest");
const vault = new AgentVault({ vaultId: VAULT, transport: nearApiTransport({ signerId: VAULT, privateKey: key.toString(), rpcUrl: RPC }) });
const action = { adapter: "swap" as const, target: SWAP, amount, minAmountOut: minOut };

console.log(`vault  ${VAULT} (${await vault.vaultVersion()})\nagent  honest  ${key.getPublicKey().toString()}\n`);

const before = await vault.budget();
const near0 = before.tokens.find((t) => t.token === "near");
console.log(`1. budget: ${fmt(near0?.remaining ?? "0")} left of ${fmt(near0?.dailyCap ?? "0")} today; vault balance ${fmt(before.balanceNear)}`);

try {
  const sim = await vault.simulate(action);
  console.log(`2. simulate: ${sim.verdict}${sim.reason ? ` (${sim.reason})` : ""}, target class ${sim.targetClass}`);
} catch (e) {
  console.log(`2. simulate: not on this vault version (${e instanceof Error ? e.message.split(";")[1]?.trim() : e})`);
}

const r = await vault.spend(action);
console.log(`3. spend swap ${fmt(amount)} on ${SWAP}, min_amount_out ${fmt(minOut)}`);
if (r.ok) console.log(`   settled ${r.settled}  https://testnet.nearblocks.io/txns/${r.tx}`);
else console.log(`   refused: ${r.reason}, target class ${r.targetClass}  https://testnet.nearblocks.io/txns/${r.tx}`);

const after = await vault.budget();
const exposure = (await vault.exposure()).find((e) => e.target === SWAP && (e.token ?? "near") === "near");
console.log(`4. spent today ${fmt(after.tokens.find((t) => t.token === "near")?.spentToday ?? "0")}; exposure to ${SWAP}: ${exposure ? `${fmt(exposure.amount)} recorded as ${exposure.classAtRecord}` : "none"}`);
if (!r.ok || !r.settled) process.exit(1);
