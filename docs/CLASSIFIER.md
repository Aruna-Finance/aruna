# Classifier — the core of the product

None of the five projects surveyed in `COMPETITIVE.md` has this. Everything else in Aruna
exists to make it visible, usable and actionable.

Read `NEAR-FACTS.md` §4, §6 and §7 before changing any logic here.

---

## Shape: one core, four surfaces

```ts
// @aruna/classifier-core — zero dependencies, no NEAR account, signs nothing
export async function classify(
  accountId: string,
  rpc: RpcReader,              // injected: fetch-based in browser, node in CLI
): Promise<Classification>;

export interface RpcReader {
  viewAccount(accountId: string): Promise<ViewAccount>;
  viewAccessKeyList(accountId: string): Promise<AccessKeyList>;
  viewCode(accountId: string): Promise<{ codeBase64: string; hash: string }>;
}
```

The `RpcReader` injection is what lets the same code run in a browser tab, in a Node
CLI, inside the MCP server and inside the attestor. **Do not import a NEAR SDK into the
core.** The three RPC calls above are plain JSON-RPC and must be implemented in the
surface, not the core.

| Surface | Purpose |
|---|---|
| `apps/web` | Static page. Paste any account id, see its class and evidence. No wallet, no backend |
| `@aruna/cli` | Batch runs. Class distribution across the top N mainnet contracts |
| `@aruna/mcp` | Keyless tool usable by any agent, including agents that never touch our vault |
| `@aruna/attestor` | The same checks on a schedule, feeding drift reports |

---

## The four classes

| Class | Condition | Certainty | Insurable |
|---|---|---|---|
| `immutable_verified` | all three checks below pass | no detected upgrade path under these checks, and sticky. Pending T9 | yes, lowest premium |
| `local_upgradeable` | own code, or an upgrade path exists | detected | yes |
| `global_by_account` | references another account's global contract | detected, but only through a non-obvious channel | yes, highest premium |
| `unknown` | cannot be determined | not known | **no** |

`unknown` is never insurable. Pricing something you cannot determine is the fastest way
to lose both underwriters and buyers.

### The recorded basis

The class says what we can state; `mutabilityBasis` in the evidence says why. It never
changes the class, and it stops `local_upgradeable` from being too broad to be useful.

| `mutabilityBasis` | Class | Meaning |
|---|---|---|
| `no_detected_path` | `immutable_verified` | by hash, no full-access key, no scanned import |
| `full_access_key` | `local_upgradeable` | a key holder can change the code. Takes priority when several apply |
| `upgrade_imports` | `local_upgradeable` | no full-access key, but a scanned import exists. **It may have no reachable route** |
| `own_code` | `local_upgradeable` | local code, no full-access key, clean imports, not by hash |
| `global_owner` | `global_by_account` | another account can redeploy the code |
| `undetermined` | `unknown` | no code, or code that cannot be fetched or parsed |

---

## Procedure

Run in order. Stop at the first match.

### Step 1 — how is the code referenced

```
viewAccount(target)
```

Read the fields in **this** order:

- `global_contract_hash` present → referenced **by hash** → go to step 2
- `global_contract_account_id` present → **`global_by_account`**, done
- `code_hash` is not the zero hash → local code → go to step 2, to record the keys
- `code_hash` is the zero hash (`1111…1111`) and neither global field is present →
  no code → **`unknown`**

> A zero `code_hash` does **not** mean "no code" — an account using a global contract
> also reports zero. That is why the global fields are checked first. This is a verified
> lab finding, not a precaution.

### Step 2 — can a key change the code

```
viewAccessKeyList(target)
```

Count keys whose permission is **FullAccess**.

- **any full-access key** → its holder can re-point the reference with
  `UseGlobalContract`, or deploy over local code → **`local_upgradeable`**
- **no full-access keys** → go to step 3

> **Function-call keys do not disqualify an account.** `UseGlobalContract`,
> `DeployContract` and `AddKey` are account actions that require full access; our lab
> proved a function-call key is rejected with `RequiresFullAccess`. An account may hold
> any number of function-call keys and still be immutable.
>
> This corrects an earlier version of this spec that required the key list to be
> *empty*. That version would have failed Aruna's own vault, which carries one
> function-call key per agent. See `TESTING.md` for the test that confirms it.

### Step 3 — scan the WASM import section

```
viewCode(target)
```

Parse the module's import section. Look for:

| Import | Meaning if present |
|---|---|
| `promise_batch_action_deploy_contract` | the contract can deploy code to an account |
| `promise_batch_action_use_global_contract` | it can re-point a global reference |
| `promise_batch_action_use_global_contract_by_account_id` | same |
| `promise_batch_action_add_key_with_full_access` | it can hand control back to a key |
| `promise_batch_action_add_gas_key_with_full_access` | same, through a gas key |
| `promise_batch_action_delete_account` | it can delete the account, freeing the name for a parent to recreate with other code |

`promise_batch_action_add_key_with_function_call` and `promise_batch_action_delete_key` are
**not** on this list: a contract may manage function-call keys and still pass. Still to
review: `promise_batch_action_deploy_global_contract_by_account_id`,
`promise_batch_action_state_init`, `promise_batch_action_state_init_by_account_id`,
`promise_batch_action_universal_state_init`.

Decision:

- any present → an upgrade path cannot be ruled out → **`local_upgradeable`**
- none present, and step 1 said by hash, and step 2 found no full-access keys →
  **`immutable_verified`**
- none present, and step 1 said local code → own code → **`local_upgradeable`**
- code unavailable or the module will not parse → **`unknown`**

**Why absence is sound:** a contract cannot call a host function it does not import.

> Until lab test T9 confirms the `delete_account` path, describe `immutable_verified`
> as "no detected upgrade path under these checks" rather than as an unqualified
> proof. See `DECISIONS.md` D-10.

Parse the import section only; do not attempt flow analysis.

**Presence is not proof of a path.** Measured with near-sdk 5.30.1: a contract using `Promise`
imports all of these functions even when it calls none of them (`NEAR-FACTS.md` §4). Those
contracts land in `local_upgradeable` with `mutabilityBasis: "upgrade_imports"`. Never display
that as "can be upgraded".

### Stickiness

Once `immutable_verified` holds, nothing in the listed checks can undo it: without a
full-access key nobody can add one, and without the relevant imports the code cannot
replace itself. Cache it permanently only after T9 passes.

The other three classes **must be re-checked on a schedule.**

---

## Who may record a class

Only accounts in the registry's **authorized classifier set** may write a classification
on chain. An open write path makes every downstream decision meaningless. The vault
reads its own cache, refreshed from the registry under a staleness bound — it is the
**most recently recorded** class, never a live read. No contract can read another
account's state.

## Evidence

Every classification stores what it was based on, so anyone can reproduce it.

```ts
type ClassEvidence = {
  accountId: string;
  checkedAtBlock: number;
  codeRef:
    | { kind: "local";          codeHash: string }
    | { kind: "global_hash";    globalHash: string }
    | { kind: "global_account"; ownerAccount: string };
  fullAccessKeyCount: number;
  functionCallKeyCount: number;        // recorded, does not affect the class
  resolvedCodeHash: string | null;     // from viewCode, NOT viewAccount
  upgradeImports: string[];            // empty means clean
  mutabilityBasis: "no_detected_path" | "full_access_key" | "upgrade_imports"
                 | "own_code" | "global_owner" | "undetermined";
  wasmParsed: boolean;
};
```

`resolvedCodeHash` comes from `viewCode`, **not** from `viewAccount.code_hash`. For
`global_by_account` targets the two differ, and the first is the true one.

---

## Drift monitoring — four channels

Watching `view_account.code_hash` alone **misses every change on `global_by_account`
targets.** This is proven in the lab, and it is the hole most monitoring has.

| Channel | Catches |
|---|---|
| `viewCode(target).hash`, polled | changes to the resolved code, all classes |
| `DeployContract` action on the target | local upgrades |
| `UseGlobalContract` action on the target | re-pointed global references |
| `DeployGlobalContract` on the **owner** account | changes that never touch the target at all |

The fourth channel is one none of the five surveyed projects has. It gives direct notice of
a `global_by_account` change, which polling the resolved code only sees at the next poll.

**Polling interval is part of the product, not an implementation detail.** Detection
time is bounded by the interval, and that adds to the TOCTOU window. It must appear in
the coverage period definition. In the lab, new code became active 3 blocks after the
owner's deploy on the by-account path.

---

## The headline measurement

**Run this before any number goes on the first screen.** Read-only mainnet access is allowed.
No transactions.

**Data source.** Plain RPC cannot produce "top N by calls". Use the NEAR BigQuery public
dataset (`docs.near.org/data-infrastructure/big-query`), filter on `block_date` to control
cost, and keep the query in the repo. Accounts then go through `classifier-core` over RPC.

**Measure both headlines, and lead with whichever is stronger:**

1. What share of the top N most-called contracts is `global_by_account`, and so invisible to
   hash-based monitoring.
2. What share can change under an agent at all: `full_access_key`, `global_owner` and
   `own_code`, against `immutable_verified`, with `upgrade_imports` **reported separately**
   because it inflates the total.

**The finding does not depend on prevalence.** It is about monitoring correctness: even at a
low share, monitoring is silently wrong for this class.

**Methodological note that must be published with it:** counting `DeployContract`
actions alone misses changes made through global-by-account. Either add
`DeployGlobalContract` on owner accounts as a second channel, or state the figure as a
lower bound.
