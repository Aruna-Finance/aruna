# Deploying the attestor and the keeper on Railway

Two services, two keys, both testnet only. The **attestor** watches the targets the registry assigns to it, keeps its
heartbeat fresh and files signed drift reports. The **keeper** waits until a target's latest report is final,
re-classifies the target, writes its class and lifts the freeze when the new class is no riskier. Both build from this
repository with `pnpm deploy`; no `@aruna` package has to be on npm. Plan:
`docs/plans/2026-11-13-2018-feat-hosted-attestor-keeper-plan.md`.

Why this matters: the pool refuses to sell coverage on a target whose assigned attestor's heartbeat is older than 600
blocks (about 10 minutes) or whose target is frozen. Without these two services, no target can be covered.

## Before you start

- A Railway project with the Railway GitHub app granted access to `Aruna-Finance/aruna` (the indexer guide,
  `docs/DEPLOY-INDEXER-RAILWAY.md`, covers this).
- On your own machine, the full-access keys of `arunafi.testnet` (the registry owner) and `attestor-a.arunafi.testnet`.
  They stay there. Neither goes into Railway.
- `attestor-a.arunafi.testnet` already registered on `registry2.arunafi.testnet` with its signing key and 1 NEAR bond. Its
  signing seed is the `seed_hex` field of `~/.near-credentials/aruna-attestors/attestor-a.arunafi.testnet.json`. Open
  that file yourself; do not paste it into a chat or a file in the repository.
- The indexer's URL, `https://aruna-near-indexer.up.railway.app`. It may still be catching up; both services also take a
  seed list, so they work while it does.
- `near` (near-cli-rs 0.31 or later), and this repository built (`pnpm install && pnpm -r build`) for the read-only
  checks below.

## Steps

### 1. Create the two function-call keys

Each service gets a key that can call only the registry and only the methods it needs. Neither method takes a deposit, so
a function-call key works, and a leaked key cannot move the account's funds or change its keys.

```bash
# The attestor's key, on attestor-a: heartbeat and report_drift.
near account add-key attestor-a.arunafi.testnet grant-function-call-access \
  --allowance '1 NEAR' --contract-account-id registry2.arunafi.testnet --function-names 'heartbeat, report_drift' \
  autogenerate-new-keypair print-to-terminal network-config testnet sign-with-legacy-keychain send

# The keeper's key, on the registry owner: set_class, lift_freeze and push_freeze.
near account add-key arunafi.testnet grant-function-call-access \
  --allowance '1 NEAR' --contract-account-id registry2.arunafi.testnet --function-names 'set_class, lift_freeze, push_freeze' \
  autogenerate-new-keypair print-to-terminal network-config testnet sign-with-legacy-keychain send
```

Each command prints a new key pair to your terminal. Copy each private key (`ed25519:...`) straight into the matching
Railway variable in step 2; do not save it anywhere else.

The allowance is the gas the key may spend over its life. `1 NEAR` is a starting point. The first measurement (see "Recorded
runs") is about 0.0002 NEAR per call, which at one heartbeat every three minutes is about 0.09 NEAR a day: 1 NEAR lasts
about 11 days. Read the remaining allowance with `near account list-keys` and size it for how long the service should run
unattended. An exhausted allowance shows up as repeated failed calls in the service log.

Expected: `near account list-keys attestor-a.arunafi.testnet network-config testnet now` and the same for
`arunafi.testnet` each list the new public key next to the full-access key, with function-call permissions.

### 2. The attestor service

New service from `Aruna-Finance/aruna`, branch `main`.

- Settings, Source: Root Directory `/` (the image builds from the repository root).
- Settings, Config file: `/packages/attestor/railway.json`.
- No public domain: it serves no HTTP.
- A volume mounted at `/data`. It holds the last observation of each target; without it a restart forgets what it saw, and
  a change made while it was down is never reported.
- Variables:

  | Variable | Value | Secret |
  |---|---|---|
  | `ARUNA_ATTESTOR_ACCOUNT` | `attestor-a.arunafi.testnet` | no |
  | `ARUNA_ATTESTOR_REGISTRY` | `registry2.arunafi.testnet` | no |
  | `ARUNA_ATTESTOR_ACCOUNT_KEY` | the private key printed for `attestor-a` in step 1 | **yes** |
  | `ARUNA_ATTESTOR_SIGNING_SEED_HEX` | the `seed_hex` from your attestor key file | **yes** |
  | `ARUNA_INDEXER_URL` | the indexer's URL | no |
  | `ARUNA_ATTESTOR_TARGETS` | `swap.arunafi.testnet,drift-target.arunafi.testnet`, the seed list | no |
  | `RAILWAY_RUN_UID` | `0` | no |
  | `ARUNA_RPC_TESTNET` | optional: an RPC endpoint of its own, apart from the indexer's quota | maybe |

  `RAILWAY_RUN_UID=0` is Railway's workaround for a volume that a non-root image cannot write
  (https://docs.railway.com/reference/volumes, "Caveats").

Expected, in the service's deploy log: `attestor-a.arunafi.testnet on registry2.arunafi.testnet: signing key ed25519:2fD21B5E...
matches the registry`, then `watching` followed by the targets that the registry confirms, then `heartbeat` and a
transaction hash. If the signing seed is not the one the registry holds, the service stops with a message naming both
public keys.

### 3. The keeper service

New service from the same repository and branch.

- Root Directory `/`, config file `/packages/keeper/railway.json`, no public domain, no volume, no `RAILWAY_RUN_UID`.
- Variables:

  | Variable | Value | Secret |
  |---|---|---|
  | `ARUNA_KEEPER_ACCOUNT` | `arunafi.testnet` | no |
  | `ARUNA_KEEPER_REGISTRY` | `registry2.arunafi.testnet` | no |
  | `ARUNA_KEEPER_KEY` | the private key printed for `arunafi.testnet` in step 1 | **yes** |
  | `ARUNA_INDEXER_URL` | the indexer's URL | no |
  | `ARUNA_KEEPER_TARGETS` | `swap.arunafi.testnet,drift-target.arunafi.testnet`, the seed list | no |
  | `ARUNA_RPC_TESTNET` | optional | maybe |

Expected, in its log: `keeper arunafi.testnet on registry2.arunafi.testnet, key ed25519:...` (the function-call key's
public half, which you can match against step 1), then a `checked N target(s)` line every minute.

### 4. Assign `swap` to the attestor

`drift-target` is already assigned to `attestor-a`; `swap` is not. Send the assignment as the registry owner, from your
machine:

```bash
near contract call-function as-transaction registry2.arunafi.testnet assign_attestor \
  json-args '{"target":"swap.arunafi.testnet","attestor":"attestor-a.arunafi.testnet"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as arunafi.testnet network-config testnet sign-with-legacy-keychain send
```

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet assigned_attestor '{"target":"swap.arunafi.testnet"}'
```

Expected: `"attestor-a.arunafi.testnet"`. Within about three minutes the attestor's log shows it watching `swap`, with no
redeploy.

### 5. Check that coverage can be sold

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"swap.arunafi.testnet"}'
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"drift-target.arunafi.testnet"}'
```

Expected: `true` for both. On 13 November 2026, before the attestor ran, `drift-target` read `false`.

### 6. Check the keeper released `drift-target`

`drift-target` has been frozen since report 2 was verified, and its class record is older than that report.

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet get_class '{"target":"drift-target.arunafi.testnet"}'
```

Expected within a few minutes of the keeper starting: `"frozen":false`, `"classified_at_block"` newer than report 2's
`reported_at_block` (277193160), and the current `resolved_code_hash`. The keeper's log has a `freeze lifted` line and a
`class written` line for it, each with a transaction hash.

### 7. Buy coverage on `swap` from the console

In the console, open a vault whose agent may use `swap.arunafi.testnet` and buy coverage on it. Expected: the purchase is
not refused for a stale heartbeat. (Before step 4 it was refused: the target had no attestor.) Two other rules of the pool
refuse a purchase, each with a `coverage_refused` event in the transaction: the agent's `max_risk_class` must be at least the
target's class (`swap` is `local_upgradeable`, so an agent limited to `immutable_verified` is refused), and the window must
be longer than the waiting period (120 blocks) and at most 30 days (1,296,000 blocks).

### 8. Restart the attestor

Restart the attestor service from the Railway dashboard. Expected: its log shows `watching` with the same targets and no
`first observation` line for a target it already knew, because the volume kept its state.

## Operating

**Adding a target.** `assign_attestor` for it (step 4's command). The attestor picks it up within about three minutes. For
the keeper, add it to `ARUNA_KEEPER_TARGETS` only if the indexer is behind: once the indexer has the target's report it
is found without a seed.

**A freeze the keeper held.** When the new code classifies riskier than before, or when someone has already written the
target's class by hand since the report, the keeper leaves the freeze. In the first case it writes the new class and logs
a `HELD` line naming the target, both classes and the report. Review the new code (`node
packages/cli/dist/index.js classify <target> --network testnet`), then decide. To release it:

```bash
near contract call-function as-transaction registry2.arunafi.testnet lift_freeze \
  json-args '{"target":"<target>"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as arunafi.testnet network-config testnet sign-with-legacy-keychain send
```

**An exhausted allowance or a leaked key.** Create a replacement key (step 1), set it as the secret, then delete the old
one with its public key:

```bash
near account delete-keys <account> public-keys ed25519:<old public key> network-config testnet sign-with-legacy-keychain send
```

A leaked attestor key can send heartbeats and reports as `attestor-a`, and nothing else. A leaked keeper key can call
`set_class`, `lift_freeze` and `push_freeze` as the registry owner, and nothing else (`push_freeze` is open to anyone
anyway); but `set_class` can record any target as any class,
so this is the key to guard most. A leaked signing seed lets an attacker sign reports as `attestor-a`: rotate it with
`rotate_signing_key` from your machine.

**When a service is down.** Railway restarts it. While the attestor is down longer than about 10 minutes, the pool
refuses new coverage; the console shows why on the purchase screen. A change made while it was down is still reported
if it is within the registry's lookback bound (600 blocks) of the attestor's return; an older one cannot be reported.

## Considered and not built

An alert to the team when a heartbeat goes stale or a service's gas runs low, a public status line for the attestor, a
startup check that the keeper's key can call both methods, and a second attestor on its own host. None was asked for; the
purchase screen already shows a stale heartbeat, and a keeper whose key cannot call a method logs the failed call each
run. Revisit when a customer depends on coverage being available.

## Recorded runs

13 November 2026, testnet, `registry2.arunafi.testnet` and `pool2.arunafi.testnet`. Transaction hashes are as the service
logs and the explorer show them.

| Step | What happened | Transaction |
|---|---|---|
| 2 | Attestor started: its signing key matched the registry, `drift-target` watched, first heartbeat at 14:32 UTC | `Ge8kVq33ky7cUzQf4DDAcQUL8gT8jTVai1Gfw7SuuHDu` |
| 3, 6 | Keeper started at 14:40 UTC and, for `drift-target` (`global_by_account` before and after, report 2), lifted the freeze, then wrote the class | `d9agTuYvgnLYkxatJ4RYyGDyGSq4AMEnwAYyTJ9FuEn`, `FzQVaZNkFyJYfpRgg5qrJTxUTuhwWoX4GrP82Vf8eXQp` |
| 4 | `assign_attestor` for `swap`: `assigned_attestor` read `"attestor-a.arunafi.testnet"` and `heartbeat_fresh` read `true` | `Xw3J34tpnfPJ1ssPo3GyijZepPmj48EK9JZAvE1Kt11` |
| 7 | First purchase on `swap`, 30-day window: refused, agent `max_risk_class` below the target's class | `YmKQtikLa3oVsirbwrRe8z8WyGyhUWiMYu6VX4f9ZKR` |
| 7 | Second purchase, 47-day window: refused, window above the 30-day maximum | `6xPdNrsYJtNCTUWoyvaJfUmxKi8uyfDHobzUqX2Gwq7J` |
| 7 | Purchase with an agent whose `max_risk_class` allows the target, 30-day window: **coverage 5**, premium 0.0723 NEAR, blocks 277536453 to 278832453 | `5JKM2nNAbqHYgQXww9jrgH7VdEmyL4cLabmbPYjsdFpK` |
| 8 | Attestor restarted at 16:48 UTC: it logged `watching swap.arunafi.testnet, drift-target.arunafi.testnet` and a heartbeat, and no `first observation` line, so the volume kept its state | `GScy37PSkLkiPU1nJMeuyxhjJd1Tobbww7h7pH6aANi9` |

Gas, from the first hours (an estimate from a few calls, not a long run):

| Call | Cost |
|---|---|
| attestor `heartbeat` | about 0.0002 NEAR of the key's allowance (0.99937 NEAR left of 1 after three) |
| keeper `lift_freeze` or `set_class` | about 0.00024 NEAR each (0.99953 NEAR left of 1 after two) |
| `assign_attestor` from the owner's full-access key | 2.4 Tgas used, fee 0.00022 NEAR |

13 November 2026, 18:50 to 19:15 UTC: a new code change on `swap`, end to end with the hosted services. The keeper ran
`e50fded` (it pushes freezes) with a new function-call key `ed25519:CkXsW4sC...` for `set_class`, `lift_freeze` and
`push_freeze`; the old key was deleted. `swap` was redeployed from `fixtures/wasm/swap/swap.wasm` (`FKcT28qs...`,
`version()` `swap-v1`) to `fixtures/wasm/swap/v2/swap.wasm` (`8sABxpno...`, `swap-v2`), same behaviour.

| Block | What happened | Transaction |
|---|---|---|
| 277543827 | Before the change: agent `test-agent-02` of `test-vault-0` swaps 0.1 NEAR from the console Playground; `exposure_recorded` 0.1 NEAR | `FhQjto9w1UeFs2d6CVzx3yHcknu5wP6qimFCoh4NjpS4` |
| 277550315 | `swap` redeployed to v2 by its own full-access key | `93vS9JoeXx54Xh43pE3V2REPpKYFDwA3G4dSPjCwdeLJ` |
| 277550346 | attestor-a files report 3 (`deploy_contract`, `FKcT28qs...` -> `8sABxpno...`, changed at 277550315): `swap` frozen in the registry, 31 blocks after the change | `5K5NfBuNf9ykvQ9xUTVDkzhyCbiDDJZSxLnHysyZ6r8w` |
| 277550447 | keeper `push_freeze {from:0, limit:20}`: 11 vaults called, 8 `target_frozen` (every vault whose ceiling allows `swap`; all 8 read `open` before), no failed receipt, 27.6 Tgas burnt | `7nXUhZdHSay2EjmmemuBU9qju5tKu2fvUJaE5XtRF2pq` |
| 277550646 | report 3 Verified (challenge window closed) | — |
| 277550654 | keeper `lift_freeze` | `D7vX3zRY5T6KqkSjL82754ypgsgzwZiTyjkmRhdUuQwT` |
| 277550661 | keeper `set_class`: `local_upgradeable` -> `local_upgradeable`, `resolved_code_hash` `8sABxpno...` | `AstPvQkYciFinCazozU1QwsSqMfWEQGN4BqNnXTE58Wq` |
| 277551126 | claim on coverage 5 for report 3, sent from the console Claims screen: `claim_paid`, exposure 0.1 NEAR x 80% = **0.08 NEAR** to `arunafi.testnet` | `Bpqr87b3Fzw4afXmEmMYZLoze3nahUWi7WjkZJYMqjW5` |

Check it:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet get_report '{"id":3}'
node fixtures/tools.mjs view registry2.arunafi.testnet get_class '{"target":"swap.arunafi.testnet"}'
node fixtures/tools.mjs view pool2.arunafi.testnet get_coverage '{"id":5}'
node fixtures/tools.mjs view test-vault-0.factory2.arunafi.testnet get_class '{"target":"swap.arunafi.testnet"}'
```

Expected: report 3 `verified`; the class record `frozen:false` with `classified_at_block` 277550661; coverage 5 `paid_out`
`80000000000000000000000` and one claim `paid`; and the vault's cached class still `frozen:true`. That last line is the
freeze the keeper pushed, which outlives `lift_freeze` in each vault until `refresh_class` runs (the SDK does so on the next
`spend`, `docs/SDK.md`). The SDK's retry on that refusal has unit tests; it was not run on chain here.

Next `swap` change: redeploy `fixtures/wasm/swap/swap.wasm` to flip back to v1.
