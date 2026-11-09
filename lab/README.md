# Renkarna protocol lab — T0–T4 on nearcore 2.14.0 (protocol 88)

Run: `cd lab && (cd contracts/<c> && cargo near build non-reproducible-wasm --no-abi)` for gate/usdc/funder/target
(target twice: default → `target_v1.wasm`, `--features v2` → `target_v2.wasm`), then
`cargo run -p harness --release -- [t0|t1|t2|t3|t4|all]`. Raw output goes to `results/*.json`.

Sandbox root account is `sandbox`, so `parent.test.near` becomes `parent.sandbox`, and so on.

## Blockers (checked first)

| Item | Finding |
|---|---|
| Sandbox | `near-sandbox 0.4.0` defaults to nearcore **2.14.0 → protocol 88**. `0.3.12` (the template's version) pins 2.13.0. Use 0.4.x. |
| Rust | `near-sdk 5.30` / `near-primitives 0.38` need rustc ≥ 1.95 (lab uses 1.96). |
| `near-primitives 0.38` | Has everything: `GasKeyFunctionCall`, `TransferToGasKey`, `WithdrawFromGasKey`, `TransactionV1` + `GasKeyNonce`, `DelegateV2`. |
| `near-api 0.8.7` | Can only **read** gas keys. It cannot build gas-key actions or sign `TransactionV1`, so the harness signs by hand (`harness/src/rpc.rs`). |
| `near-sdk 5.30` | `Promise::transfer_to_gas_key`, `add_gas_key_*` are available. |
| `near-cli-rs` | 0.31.0-rc.2 (not 0.30.1) has `fund-gas-key`, `withdraw-from-gas-key`, AddKey with gas key. |
| **DelegateV2** | **Rejected on protocol 88:** `RemovedProtocolFeature {protocol_feature: "DelegateV2", version: 88}`. Meta-transactions signed by a gas key do not work here. |

## T1 — who can fund an agent's gas key

| Test | Result | Error / note |
|---|---|---|
| T1a literal: `AddKey` with `balance=1N` | ✗ Rejected | `ActionsValidation: AddGasKeyWithNonZeroBalance` — the balance cannot be set in AddKey |
| T1a-alt: `[Create, Transfer, AddKey(balance 0), TransferToGasKey 1N]` | ✓ | gas key = 1 N |
| T1a-contract: factory promise batch (predecessor = funder) | ✓ | gas key = 1 N |
| T1b: parent → `TransferToGasKey` afterwards | ✓ | 1.0 → 1.5 N |
| T1b: **unrelated** account → `TransferToGasKey` | ✓ | anyone can top up |
| T1c: third-party contract `promise_batch_action_transfer_to_gas_key` | ✓ | 2.0 → 2.5 N |
| T1d: DelegateV2 (agent as sender) | ✗ Rejected | `RemovedProtocolFeature DelegateV2` (control case with an allowed action fails the same way) |
| Withdraw by parent | ✗ on-chain | `ActorNoPermission` |
| Withdraw by the agent's gas key | ✗ Rejected | `RequiresFullAccess` |
| Gas key runs out | ✗ Rejected | `NotEnoughGasKeyBalance {balance:"1", cost:"30919103596387000000000"}`. Prepaid gas (30 Tgas ≈ 0.031 N) must be covered up front. |

**Depletion:** 10× `gate.execute` (3 receipts each, 30 Tgas prepaid) cost **0.000434 N net per call, about 2,305 calls per NEAR**.
The gas key's drop equals the sum of `tokens_burnt`, so the refund goes back to the gas key. The agent's account balance did not change.

**Decision:** the T1a ✓ / T1b ✓ row holds, but with corrections:
1. Funding at creation must use `TransferToGasKey` inside the batch, not `gasKeyInfo.balance`.
2. Top-ups are permissionless, so anyone can sponsor.
3. Funds in the gas key are **one-way**: an agent without a full key can never withdraw them. Sponsor in small amounts.

## T0 — agent isolation

| # | Action | Result |
|---|---|---|
| 1 | Transfer | Rejected `RequiresFullAccess` |
| 2 | AddKey on self | Rejected `RequiresFullAccess` |
| 3 | DeployContract on self | Rejected `RequiresFullAccess` |
| 4 | FunctionCall to usdc | Rejected `ReceiverMismatch {ak_receiver: gate.sandbox}` |
| 5 | gate.other | Rejected `MethodNameMismatch {method_name: "other"}` |
| 6 | parent AddKey on agent | **On-chain** `ActorNoPermission {actor_id: parent.sandbox}` (also DeployContract, DeleteAccount) |

⚠️ **#1–#5 never reach the chain.** The node rejects them at validation (`InvalidTxError`), so their tx hashes exist only locally and **cannot be checked in an explorer**. Only #6 leaves an on-chain trace.
For the demo, show the RPC error itself (reproducible), or replace a case with one that does land on-chain.
Sandbox hashes also disappear when the sandbox stops. Anything a judge must re-verify has to run on testnet.

## T4 — deposits on restricted keys

| Key | deposit 1 yocto | deposit 0 → `ft_transfer` |
|---|---|---|
| Regular FunctionCall (gate / usdc) | Rejected `DepositWithFunctionCall` | on-chain panic `Requires attached deposit of exactly 1 yoctoNEAR` |
| GasKeyFunctionCall (gate / usdc) | Rejected `DepositWithFunctionCall` | same panic |

Confirmed: no restricted key, gas key or not, can move NEP-141 tokens directly. A gate holding pre-funded deposits is the only possible architecture.

## T2 — TOCTOU window (single shard)

The attestor reads the code hash (v1). `gate.execute` lands in block G, gate runs at G+1, and `target.version()` runs at G+2.

| Deploy v2 lands at | version() returns |
|---|---|
| G (same block) | **v2** |
| G+1 | **v2** |
| G+2 (same block as version()) | **v2** (the local DeployContract receipt runs first) |
| G+3 | v1 |
| self_upgrade via promise, sent in block G | **v2** |

The window covers the attestor's check → G+2, inclusive (**≥3 blocks after the gate tx**, plus the attestor-to-submit latency). Each extra promise hop or cross-shard hop adds blocks.
A check before execution cannot guarantee which code actually runs.

## T3 — does the code hash track the executed code?

**Path A (global by account ID):** the owner redeploys v2, and no transaction touches user-a.

| Field | Before | After |
|---|---|---|
| `view_account.code_hash` | `1111…1111` (zero hash) | `1111…1111` — **unchanged** |
| `view_account.global_contract_account_id` | `owner.sandbox` | `owner.sandbox` — **unchanged** |
| `view_code.hash` | `73ETF…` (v1) | `J2gKR…` (v2) — changed |
| `version()` | v1 | **v2** |

The new code took effect 3 blocks after the owner's deploy (height 322 → 325).
**False negative confirmed:** a trigger based on `view_account` never sees the change. Two options:
- Use `view_code` (the hash actually resolved), polled continuously.
- Watch `DeployGlobalContract` from the owner account.

Even an account with no contract of its own reports a zero `code_hash`, so "code_hash == zero" does not mean "no code".

**Path B (by hash):** `view_account.global_contract_hash` shows the immutable hash, and it can be read. However:
- An account that **still holds a full key can re-point** with `UseGlobalContract` to another hash (v2 → v1 succeeded).
- Only **by-hash + no access keys at all** (`user-c`, keys `[]`) gives a protocol-level guarantee. Even then, the code must not contain its own upgrade path. Here `#[private]` blocked outsiders: `Method self_upgrade is private`.

The cheapest tier is therefore: `global_contract_hash` set, `view_access_key_list` empty, and a bytecode check for deploy/use_global_contract host functions.
