# NEAR facts — verified, and what is impossible

**Read this before writing any contract code.**

Everything under "verified" was tested in our own lab: `near-sandbox` 0.4.0,
nearcore 2.14.0, **protocol 88**, single-shard sandbox, root account `sandbox` (so
`parent.test.near` becomes `parent.sandbox`). The error strings below are what the node
actually returned, copied verbatim.

Anything not in this file: **do not assume it.** Check the docs, or measure it.

---

## 1. What is impossible

Five routes, each tested, each closed. **Do not design around them, do not try to work
around them, do not leave a TODO implying a later fix.**

| Impossible | Why |
|---|---|
| A contract reading another account's `code_hash`, state or access keys | No host function exists. `near-sys` offers own-account storage, promises, crypto, validators |
| A contract calling RPC | The runtime provides no such path |
| A cross-contract call reading raw state | It can invoke *methods* only |
| Guaranteeing the target's code at execution time by checking beforehand | TOCTOU window ≥ 3 blocks, §5 |
| Trusting a target to report its own code identity | Malicious code can return a false value |

Direct consequence: **detecting code change requires an off-chain observer.** That is
permanent under the current protocol, not a temporary gap.

---

## 2. Access keys — what they can and cannot do

`FunctionCallPermission` carries `receiver_id`, `method_names`, `allowance`.

> **Scope caveat.** These rows were tested with `GasKeyFunctionCall` keys on
> sub-accounts. The product now uses **classic function-call keys on a contract
> account**. The permission semantics are expected to carry over, but tests T5–T9 in
> `TESTING.md` are owed before relying on them. Treat the rows below as
> *tested under the previous model*.

Tested from an agent key restricted to one method on one contract:

| Action | Result | Exact error | On chain? |
|---|---|---|---|
| `Transfer` NEAR | rejected | `RequiresFullAccess` | no |
| `AddKey` on itself | rejected | `RequiresFullAccess` | no |
| `DeployContract` on itself | rejected | `RequiresFullAccess` | no |
| `FunctionCall` to another contract | rejected | `ReceiverMismatch { ak_receiver: gate.sandbox }` | no |
| `FunctionCall` to a method outside the list | rejected | `MethodNameMismatch { method_name: "other" }` | no |
| Parent `AddKey`/`Deploy`/`DeleteAccount` on a sub-account | rejected | `ActorNoPermission { actor_id: parent.sandbox }` | **yes** |
| `FunctionCall` with a 1 yocto deposit | rejected | `DepositWithFunctionCall` | no |

> **For the demo:** the first five are rejected by the node **at validation**
> (`InvalidTxError`), so their transaction hashes never reach the chain and cannot be
> looked up in an explorer. Only the parent case leaves an on-chain trace.
> Evidence for judges must be a **re-runnable script** that prints the RPC errors, not
> explorer links.

### What this forces

A restricted key **cannot attach a deposit at all**. NEP-141 requires exactly 1
yoctoNEAR for `ft_transfer` and `ft_transfer_call` (tested with deposit 0: the contract
panics `Requires attached deposit of exactly 1 yoctoNEAR`).

So **an agent structurally cannot move NEP-141 tokens itself.** A vault holding
pre-funded assets is not a design choice; it is the only possible architecture. Say so
in the README.

### Implications for the key-on-vault model

If function-call keys cannot perform account actions, an account may hold any number of
them and still be unable to change its own code or keys. That is what would make Aruna's
vault classifiable as `immutable_verified` while carrying one key per agent.
See §4 and `CLASSIFIER.md` step 2.

**Not yet directly tested:** a function-call key attempting `UseGlobalContract` (T5), a
classic key with an `allowance` on a contract account (T6), a contract with no full-access
key managing its own function-call keys (T7), and an agent key attempting callbacks (T8).

### Sub-accounts

A parent is required to *create* a sub-account and has **no authority over it
afterwards**. A sub-account with no full-access key and no deployed contract can never
have a key added to it.

Trap: if a sub-account has a contract, that contract can call `add_full_access_key` on
its own account, unless its code does not import that host function.

---

## 3. Gas keys (NEP-611) — why we do not use them

Live since `ProtocolFeature::GasKeys` at protocol 85; mainnet reached 86 (nearcore 2.13).
Our lab ran at 88.

| Scenario | Result |
|---|---|
| `AddKey` with `balance` > 0 | ✗ `AddGasKeyWithNonZeroBalance` — **balance cannot be set at AddKey** |
| Batch `[CreateAccount, Transfer, AddKey(balance 0), TransferToGasKey]` | ✓ |
| Factory contract via promise batch | ✓ |
| Parent `TransferToGasKey` afterwards | ✓ |
| Unrelated account `TransferToGasKey` | ✓ — **top-up is permissionless** |
| Third-party contract `promise_batch_action_transfer_to_gas_key` | ✓ |
| `DelegateV2` with the agent as sender | ✗ `RemovedProtocolFeature { protocol_feature: "DelegateV2", version: 88 }` |
| Withdrawal by the parent | ✗ `ActorNoPermission` |
| Withdrawal by the agent's gas key | ✗ `RequiresFullAccess` |
| Gas key exhausted | ✗ `NotEnoughGasKeyBalance { balance: "1", cost: "30919103596387000000000" }` |

**Gas key funds are one-way.** An agent without a full key can never withdraw them, and
its account cannot be deleted either. Each retired agent strands its gas remainder plus
its storage stake.

Depletion measured at ~0.000434 N net per `gate.execute` (3 receipts, 30 Tgas) ≈ 2,305
calls per NEAR. **Gas-price dependent — re-derive on testnet before publishing it.**

**We do not use gas keys.** Agents are function-call keys on the vault with a classic
`allowance`, paid from the vault's balance. That removes `TransferToGasKey`,
TransactionV1 and the library-support risk below. Kept here because the facts remain
true and the lab proved them.

Library caveats found: `near-api` 0.8.7 can only **read** gas keys — it cannot build
gas-key actions or sign TransactionV1 (the harness signs by hand). `near-cli-rs` needs
≥ 0.31.0-rc.2.

---

## 4. Upgradeability — the most commonly wrong claim

**"No full-access key" does NOT mean immutable.** A locked contract can still upgrade
itself if its code exposes an authorized update method. This is common: NEAR's
`Upgradable` plugin, DAO-governed contracts, multisig, lockup.

All three must hold for a contract to be genuinely unchangeable:

1. code referenced **by hash** (not local, not global-by-account)
2. **no full-access keys** on the account
3. the WASM import section contains **no** deploy, use-global-contract,
   add-full-access-key, add-full-access-gas-key or delete-account host functions

Absence is sound: **a contract cannot call a host function it does not import.** Read the
import section; do not attempt flow analysis.

**Presence is weaker than absence.** near-sdk's `PromiseAction::add` is one `match` over every
action. Measured on 7 November 2026 with near-sdk 5.30.1 (`--release`, LTO, no `wasm-opt`), on a
one-method contract:

| How it adds one function-call key | `promise_batch_action_*` imports |
|---|---|
| `Promise::new(...).add_access_key_allowance(...)` | **17**, including deploy, delete-account, add-full-access-key, add-full-access-gas-key and use-global-contract |
| `env::promise_batch_action_add_key_allowance_with_function_call(...)` | **1**: `promise_batch_action_add_key_with_function_call` |

So the vault must use the low-level functions, and many ordinary near-sdk contracts carry these
imports with no upgrade route. T7 repeats this with `cargo near build`. Host function names are
in `near-sys/src/lib.rs`.

Condition 2 counts **full-access** keys only. Function-call keys cannot perform account
actions (§2), so they do not break immutability. An earlier version of this document
said "no keys at all" — that was stricter than necessary and would have disqualified
Aruna's own vault.

Once conditions 2 and 3 hold it is sticky: without a key or the import, no key can be added.

**Open:** a contract able to delete its own account frees the name, and a parent can
recreate a sub-account with other code. `promise_batch_action_delete_account` is
therefore scanned, and lab test T9 must confirm the behaviour before the word *proof*
is used without qualification.

---

## 5. The TOCTOU window

Measured single-shard. The gate transaction lands in block G, the gate runs at G+1, the
target's method runs at G+2.

| v2 deploy lands at | `version()` returns |
|---|---|
| G | v2 |
| G+1 | v2 |
| G+2 | v2 — the local DeployContract receipt runs first in the same block |
| G+3 | v1 |
| self-upgrade via promise, sent at G | v2 |

The window is **≥ 3 blocks** after the gate transaction, plus the delay between the
observer's check and submission. **This is a lower bound**: cross-shard flows and each
promise hop widen it. Multi-shard is untested.

The gate can refuse the *next* transaction to a changed target; it cannot stop one
already in flight. State this as an acknowledged limit.

---

## 6. Global contracts — the source of false negatives

### By account id

The owner redeploys v2. **No transaction touches the user's account.**

| Field | Before | After |
|---|---|---|
| `view_account.code_hash` | `1111…1111` (zero hash) | `1111…1111` — **unchanged** |
| `view_account.global_contract_account_id` | `owner.sandbox` | unchanged |
| `view_code.hash` | `73ETF…` (v1) | `J2gKR…` (v2) — changed |
| `version()` | v1 | **v2** |

New code active **3 blocks** after the owner's deploy.

**False negative confirmed: a trigger keyed on `view_account.code_hash` never sees this
change.** Watch `view_code` (the resolved hash) or `DeployGlobalContract` on the owner.

An account with no contract of its own also reports a zero `code_hash`, so
`code_hash == zero` does not mean "no code".

### By hash

`view_account.global_contract_hash` is readable and stable. But an account that **still
has a full-access key can re-point** it via `UseGlobalContract` (tested: v2 → v1
succeeded). By-hash alone is not enough — see §4.

---

## 7. `current_contract_code()` — self-introspection only

Host function from nearcore 2.10 (protocol 82). Requires the
`deterministic-account-ids` feature; not the default API.

| Account state | Returns |
|---|---|
| Local deploy | `local:<code hash>` |
| Global by hash | `global_hash:<hash>` |
| Global by account | `global_account:<owner id>` — **never a hash** |

After the owner redeploys v2 on the by-account path, `version()` returns v2 and
`view_code` changes, but `current_contract_code()` still returns
`global_account:<id>`.

**Do not use this to verify a target.** It is self-introspection only, and the method
wrapping it is written by the target — malicious code can lie. It gives no evidence
beyond what RPC already provides.

---

## 8. Protocol versions move

nearcore 2.14 raised the protocol from 86 to 88 in two steps: voting for 87 opened
4 November 2026, voting for 88 opened 6 November 2026. Our lab ran at 88.

**Testnet may behave differently from the lab.** Before the demo, confirm the protocol
version testnet is running, and re-measure gas costs there.

`DelegateV2` is gone at 88 — **do not plan gasless onboarding via meta-transactions.**
nearcore 2.14 also removed gas rewards for FunctionCall, which changes gas economics
relative to older documentation.

---

## 9. Never assume — check instead

| Thing | How to check |
|---|---|
| Any contract address | `docs.near.org`, or the partner's docs. Never from memory |
| An SDK method name | `docs.near.org/llms.txt`, then the page it points to |
| NEP details | Read the NEP at `github.com/near/NEPs` |
| RPC request/response shape | `docs.near.org/api/rpc` |
| Gas costs | Measure in sandbox, then re-measure on testnet |
| Library support for a new feature | Read its changelog. Many lag the protocol |
| Today's testnet protocol version | Query the node; do not assume it matches the lab |

If something is not in this file and cannot be verified: **stop and say so.** Do not
fill the gap with a plausible guess.
