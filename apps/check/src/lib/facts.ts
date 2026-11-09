// Facts copied from the project docs. Error strings are verbatim; do not retype from memory.
// Sources: docs/NEAR-FACTS.md (lab results), docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/ATTESTOR.md,
// docs/CONTRACTS.md, docs/DECISIONS.md. Prose uses a hyphen where the source used an em dash.

export const LAB = {
  sandbox: "near-sandbox 0.4.0",
  node: "nearcore 2.14.0",
  protocol: "protocol 88",
  shard: "single-shard",
} as const;

/** NEAR-FACTS.md section 1: five routes, each tested, each closed. */
export const IMPOSSIBLE: { what: string; why: string }[] = [
  {
    what: "A contract reading another account's code_hash, state or access keys",
    why: "No host function exists. near-sys offers own-account storage, promises, crypto, validators.",
  },
  { what: "A contract calling RPC", why: "The runtime provides no such path." },
  { what: "A cross-contract call reading raw state", why: "It can invoke methods only." },
  {
    what: "Guaranteeing the target's code at execution time by checking beforehand",
    why: "TOCTOU window of at least 3 blocks.",
  },
  {
    what: "Trusting a target to report its own code identity",
    why: "Malicious code can return a false value.",
  },
];

/** NEAR-FACTS.md section 2, tested with an agent key restricted to one method on one contract. */
export const ACCESS_KEY_ROWS: { action: string; result: string; error: string; onChain: string }[] = [
  { action: "Transfer NEAR", result: "rejected", error: "RequiresFullAccess", onChain: "no" },
  { action: "AddKey on itself", result: "rejected", error: "RequiresFullAccess", onChain: "no" },
  { action: "DeployContract on itself", result: "rejected", error: "RequiresFullAccess", onChain: "no" },
  {
    action: "FunctionCall to another contract",
    result: "rejected",
    error: "ReceiverMismatch { ak_receiver: gate.sandbox }",
    onChain: "no",
  },
  {
    action: "FunctionCall to a method outside the list",
    result: "rejected",
    error: 'MethodNameMismatch { method_name: "other" }',
    onChain: "no",
  },
  {
    action: "Parent AddKey, Deploy or DeleteAccount on a sub-account",
    result: "rejected",
    error: "ActorNoPermission { actor_id: parent.sandbox }",
    onChain: "yes",
  },
  { action: "FunctionCall with a 1 yocto deposit", result: "rejected", error: "DepositWithFunctionCall", onChain: "no" },
];

export const NEP141_PANIC = "Requires attached deposit of exactly 1 yoctoNEAR";

/** NEAR-FACTS.md section 4, measured 7 November 2026. */
export const IMPORT_ROWS: { how: string; imports: string }[] = [
  {
    how: "Promise::new(...).add_access_key_allowance(...)",
    imports:
      "17, including deploy, delete-account, add-full-access-key, add-full-access-gas-key and use-global-contract",
  },
  {
    how: "env::promise_batch_action_add_key_allowance_with_function_call(...)",
    imports: "1: promise_batch_action_add_key_with_function_call",
  },
];

export const IMMUTABLE_CONDITIONS = [
  "code referenced by hash (not local, not global-by-account)",
  "no full-access keys on the account",
  "the WASM import section contains no deploy, use-global-contract, add-full-access-key, add-full-access-gas-key or delete-account host functions",
] as const;

/** NEAR-FACTS.md section 5. */
export const TOCTOU_ROWS: { lands: string; version: string }[] = [
  { lands: "G", version: "v2" },
  { lands: "G+1", version: "v2" },
  { lands: "G+2", version: "v2 (the local DeployContract receipt runs first in the same block)" },
  { lands: "G+3", version: "v1" },
  { lands: "self-upgrade via promise, sent at G", version: "v2" },
];

/** NEAR-FACTS.md section 6, global contract by account id. */
export const GLOBAL_ROWS: { field: string; before: string; after: string }[] = [
  { field: "view_account.code_hash", before: "1111…1111 (zero hash)", after: "1111…1111, unchanged" },
  { field: "view_account.global_contract_account_id", before: "owner.sandbox", after: "unchanged" },
  { field: "view_code.hash", before: "73ETF… (v1)", after: "J2gKR… (v2), changed" },
  { field: "version()", before: "v1", after: "v2" },
];

/** NEAR-FACTS.md section 7. */
export const CURRENT_CODE_ROWS: { state: string; returns: string }[] = [
  { state: "Local deploy", returns: "local:<code hash>" },
  { state: "Global by hash", returns: "global_hash:<hash>" },
  { state: "Global by account", returns: "global_account:<owner id> (never a hash)" },
];

/** NEAR-FACTS.md section 3, gas keys, kept because the lab proved them. */
export const GAS_KEY_ROWS: { scenario: string; result: string }[] = [
  { scenario: "AddKey with balance > 0", result: "rejected: AddGasKeyWithNonZeroBalance (balance cannot be set at AddKey)" },
  { scenario: "Batch [CreateAccount, Transfer, AddKey(balance 0), TransferToGasKey]", result: "accepted" },
  { scenario: "Factory contract via promise batch", result: "accepted" },
  { scenario: "Parent TransferToGasKey afterwards", result: "accepted" },
  { scenario: "Unrelated account TransferToGasKey", result: "accepted (top-up is permissionless)" },
  { scenario: "Third-party contract promise_batch_action_transfer_to_gas_key", result: "accepted" },
  {
    scenario: "DelegateV2 with the agent as sender",
    result: 'rejected: RemovedProtocolFeature { protocol_feature: "DelegateV2", version: 88 }',
  },
  { scenario: "Withdrawal by the parent", result: "rejected: ActorNoPermission" },
  { scenario: "Withdrawal by the agent's gas key", result: "rejected: RequiresFullAccess" },
  {
    scenario: "Gas key exhausted",
    result: 'rejected: NotEnoughGasKeyBalance { balance: "1", cost: "30919103596387000000000" }',
  },
];

/** PRODUCT.md "Limits stated openly". */
export const LIMITS: { title: string; text: string }[] = [
  {
    title: "The attestor must be trusted, permanently",
    text: "Five routes without a third party were tested and all are closed. The arbiter is a second trust assumption. Aruna runs both at first, openly.",
  },
  {
    title: "immutable_verified is a bounded claim",
    text: "It means no detected upgrade path under the checks listed. Import presence is conservative, so the basis is always shown.",
  },
  {
    title: "An immutable vault cannot be patched",
    text: "A bug is remedied by migrating to a new vault.",
  },
  {
    title: "Recorded exposure is not current value",
    text: "The vault cannot read the target's state.",
  },
  {
    title: "The TOCTOU window is at least 3 blocks",
    text: "A single-shard lower bound. The vault can refuse the next transaction, not one in flight.",
  },
  {
    title: "Aruna itself is not covered",
    text: "The vault is a central point of failure. Mitigation is a TVL cap, immutability and an audit.",
  },
  {
    title: "What Aruna does not promise",
    text: "No guarantee that an agent decides well, no reimbursement for trading losses, no claim that any contract is safe, no assumption that every code change is an attack, no guarantee the pool always suffices.",
  },
];

/** Assumption register: each row names the doc it comes from. */
export const ASSUMPTIONS: { id: string; assumption: string; status: string; source: string }[] = [
  {
    id: "A1",
    assumption: "The attestor is trusted to observe code changes and report them.",
    status: "Permanent under the current protocol. Aruna runs it openly; an independent attestor is a condition of mainnet coverage.",
    source: "ARCHITECTURE.md, DECISIONS.md D-22",
  },
  {
    id: "A2",
    assumption: "The arbiter resolves disputed drift reports.",
    status: "A contract cannot verify counter-evidence from chain data. At MVP the arbiter is the protocol owner.",
    source: "ARCHITECTURE.md, DECISIONS.md D-22",
  },
  {
    id: "A3",
    assumption: "A lookback bound limits backdating of a reported change.",
    status: "It bounds backdating and does not eliminate it. It is not temporal truth.",
    source: "DECISIONS.md D-23",
  },
  {
    id: "A4",
    assumption: "The window between a check and execution is at least 3 blocks.",
    status: "Measured single-shard, a lower bound. Multi-shard is untested.",
    source: "NEAR-FACTS.md section 5",
  },
  {
    id: "A5",
    assumption: "Function-call key semantics measured with gas keys carry over to classic keys on a contract account.",
    status: "Expected, not proved. Tests T5 to T9 are owed before relying on it.",
    source: "NEAR-FACTS.md section 2",
  },
  {
    id: "A6",
    assumption: "Testnet behaves like the lab.",
    status: "Not assumed. The lab ran at protocol 88; confirm the testnet protocol version and re-measure gas before the demo.",
    source: "NEAR-FACTS.md section 8",
  },
  {
    id: "A7",
    assumption: "A contract cannot call a host function it does not import.",
    status: "Sound for absence. Presence of an import is weaker: it means a route may exist, not that it is reachable.",
    source: "NEAR-FACTS.md section 4",
  },
  {
    id: "A8",
    assumption: "A contract that deletes its own account cannot be recreated with other code.",
    status: "Open. The delete-account import is scanned, and lab test T9 must confirm the behaviour before the word proof is used without qualification.",
    source: "NEAR-FACTS.md section 4",
  },
  {
    id: "A9",
    assumption: "Event probabilities and capital cost used for premiums.",
    status: "Underwriting assumptions owned by the contract team, not measurements. The pricing dial on the landing page is a mock.",
    source: "CONTRACTS.md, premium",
  },
];

/** ARCHITECTURE.md contracts table and DECISIONS.md D-05. */
export const CONTRACTS: { name: string; scope: string; holds: string }[] = [
  {
    name: "vault",
    scope: "One per client, deployed by hash, no full-access key",
    holds: "Funds, agents, policy, budgets, exposure, cached classes. The whole spend path stays inside the vault.",
  },
  {
    name: "registry",
    scope: "Shared",
    holds:
      "Classifications, drift reports, challenge windows, attestor bonds, authorized classifiers, vault versions. Only authorized classifiers may write a class.",
  },
  {
    name: "pool",
    scope: "Shared, testnet only until release gate B",
    holds:
      "Underwriter capital, coverage policies, capital adequacy, concentration limits, payouts. A waiting period defends against self-dealing.",
  },
];

/** CONTRACTS.md canonical refusal reasons. SDK codes are these names without the ARUNA_ prefix. */
export const REFUSALS: { reason: string; counts: boolean; why?: string }[] = [
  { reason: "ARUNA_TARGET_NOT_ALLOWED", counts: true },
  { reason: "ARUNA_MAX_PER_TX_EXCEEDED", counts: true },
  { reason: "ARUNA_DAILY_CAP_EXCEEDED", counts: true },
  { reason: "ARUNA_SLIPPAGE_TOO_HIGH", counts: true },
  { reason: "ARUNA_RISK_CLASS_NOT_ALLOWED", counts: false, why: "a target can be reclassified under an honest agent" },
  { reason: "ARUNA_TARGET_FROZEN", counts: false, why: "a freeze hits every honest agent on the target" },
  { reason: "ARUNA_CLASS_STALE", counts: false, why: "routine, and absorbed by the SDK" },
  { reason: "ARUNA_INSUFFICIENT_BALANCE", counts: false, why: "the owner's funding, not the agent's behaviour" },
  { reason: "ARUNA_AGENT_NOT_ACTIVE", counts: false, why: "already stopped" },
  { reason: "ARUNA_AGENT_AUTO_DISABLED", counts: false, why: "already stopped" },
];

/** ATTESTOR.md lifecycle. */
export const LIFECYCLE = [
  { step: "attestor observes a change", note: "" },
  { step: "report_drift(DriftReport)", note: "Bond locks. Lookback bound checked." },
  {
    step: "target frozen",
    note: "Pushed in batches. A missed vault learns at its next refresh. New transactions are refused, not atomic across vaults. Anything already in flight cannot be stopped.",
  },
  { step: "challenge window", note: "" },
] as const;

export const BRANCHES = {
  clean: ["closes clean", "claim approved", "parametric payout from pool, to the owner"],
  disputed: ["conflicting report", "Disputed: no payout", "arbiter decides"],
  upheld: "report upheld: claim approved, payout",
  rejected: "report rejected: claim rejected, bond slashed",
} as const;

/** ATTESTOR.md "Not covered". */
export const NOT_COVERED = [
  "poor investment decisions, such as an agent buying a worthless token",
  "losses from price movement",
  "a vulnerability exploited without a code change",
  "bugs or exploits in Aruna itself, explicitly excluded",
] as const;
