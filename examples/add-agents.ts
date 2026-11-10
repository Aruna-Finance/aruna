// The AaaS company (the vault's operator) adds two agents to the demo vault, each with the same policy.
//   node examples/add-agents.ts
// Signs as the operator from ~/.near-credentials/testnet. `add_agent` needs exactly 1 yoctoNEAR, which
// only a full-access key can attach (docs/AUDIT-v0.md H1). Already-added agents are left as they are.

import { agentKey, legacyAccount, near, OPERATOR, send, SWAP, VAULT, view } from "./lib.ts";
import type { Agent } from "./lib.ts";

const policy = {
  max_per_tx: near("0.2"),
  daily_cap: near("1"),
  max_slippage_bps: 100,
  allowed_targets: [SWAP],
  max_risk_class: "local_upgradeable",
};

const operator = legacyAccount(OPERATOR);
for (const label of ["honest", "injected"]) {
  const key = agentKey(label, true).getPublicKey().toString();
  if (await view<Agent | null>("get_agent", { public_key: key })) {
    console.log(`${label}: already an agent (${key})`);
    continue;
  }
  const r = await send(operator, "add_agent", { public_key: key, label, policy }, "1", 30n * 10n ** 12n);
  console.log(`${label}: added ${key}  tx ${r.tx}`);
}

const keys = (await operator.provider.viewAccessKeyList({ accountId: VAULT })).keys;
console.log(`\nview_access_key_list(${VAULT}): the whole fleet, in one call`);
for (const k of keys) console.log(" ", k.public_key, JSON.stringify(k.access_key.permission));
