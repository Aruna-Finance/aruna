// The owner (the client) resumes a paused or auto-disabled agent. The operator cannot.
//   node examples/resume-agent.ts <label>
// Signs as the owner from ~/.near-credentials/testnet, with the 1 yoctoNEAR `resume_agent` requires.

import { agentKey, legacyAccount, OWNER, send, view } from "./lib.ts";
import type { Agent } from "./lib.ts";

const label = process.argv[2];
if (!label) throw new Error("usage: node examples/resume-agent.ts <label>");
const key = agentKey(label).getPublicKey().toString();
const r = await send(legacyAccount(OWNER), "resume_agent", { public_key: key }, "1", 30n * 10n ** 12n);
const a = await view<Agent>("get_agent", { public_key: key });
console.log(`${label}: ${a.status}, auto_disabled ${a.auto_disabled}  tx ${r.tx}`);
