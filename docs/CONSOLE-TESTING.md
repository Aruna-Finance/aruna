# Console testing: L1 to L3

How to test the live console (`apps/web`, route `/console/`), what was tested, and what is still unproven. Written for the next person or AI that extends the console, so it starts with a primer.

**How to read a box.** `[x]` means it was run and the result is recorded under Evidence. `[ ]` means it was not run, or it only passes a unit test and the build. A box is ticked only when a transaction hash, an RPC read or a pasted screen output backs it. "Hash not recorded" means the chain state proves it but nobody kept the hash.

Last updated 12 November 2026.

---

## 1. Primer

**What the console is.** Aruna measures whether the contracts an agent touches can still change. The console is the owner and operator side: create a vault, add agents with limits, pause, resume, revoke. A vault holds the funds. An agent is a function-call key on the vault, not an account. Policy refusals return an outcome with a reason code; authorization failures panic. See `CLAUDE.md` and `docs/CONTRACTS.md`.

**Rules that bind every test.** Testnet only. No keys, seed phrases or `.env` in the repo. The console never classifies a target itself, it reads the registry. No free-form call path. Never write "trustless". No em dash in copy.

**Where the code is** (`apps/web/src/console/`):

| Area | Files |
|---|---|
| Wallet | `WalletContext.tsx`, `wallet-transport.ts` (a `VaultTransport` over `@hot-labs/near-connect`, testnet only, preview before the wallet opens, `sendNear` for plain transfers) |
| Transactions | `tx-status.ts`, `ui/TxDialog.tsx` (the dialog every signed action goes through), `useLiveActions.tsx` |
| Reads | `chain-reads.ts` (testnet RPC views and balances), `useLiveVault.ts` (the vault being managed, from `?vault=` or the one remembered in this browser), `history.ts` (indexer client, fixture until `NEXT_PUBLIC_INDEXER_URL` is set) |
| Vault creation | `screens/CreateVault.tsx`, `data/factory.ts` |
| Agents | `screens/LiveAgents.tsx`, `ui/LiveAgentsTable.tsx`, `screens/LiveAgentWizard.tsx`, `screens/AgentDetail.tsx`, `screens/LiveVaultSettings.tsx` |
| Pure logic with tests | `agent-keys.ts`, `agent-actions.ts`, `live-vault.ts`, `data/agent-draft.ts`, `data/ceiling.ts` |

**Mock vs live.** Live: Create a vault, Agents list, Create an agent, agent detail, owner settings (operator, ceiling), Lookup. Still mock: Overview, Migration, Story (guided demo), TargetDetail, Coverage. With no vault selected the live screens say so; they do not fall back to sample data.

**Routes.** `/console/create/`, `/console/agents/?vault=<id>`, `/console/agents/new/`, `/console/agents/detail?agent=<public key>` (Next removes the trailing slash when a query string follows), `/console/lookup/?vault=<id>`.

**Accounts and vaults used so far** (testnet):

| What | Value |
|---|---|
| Factory | `factory2.arunafi.testnet` (`create_vault` is payable, minimum 0.5 NEAR) |
| Registry the factory reports | `registry2.arunafi.testnet`. `swap.arunafi.testnet` is `local_upgradeable`. `drift-target.arunafi.testnet` is `global_by_account` and frozen |
| Owner/operator wallet for screen tests | `brightbank9896.testnet` |
| Main test vault | `l2ocbae.factory2.arunafi.testnet` |
| Funding wallet (Meteor) | `strongpuma8118.testnet` |
| Throwaway account for scripted runs | an implicit account made from a fresh key; its key file lives outside the repo |

**Run it.**

```bash
pnpm install --registry https://registry.npmjs.org
pnpm --filter @aruna/classifier-core --filter @aruna/rpc --filter @aruna/sdk --filter @aruna/indexer build
cd apps/web
pnpm dev                    # http://localhost:3000
npx tsc --noEmit && npx vitest run && pnpm build
```

Unit tests use `renderToStaticMarkup` and pure functions (no DOM environment). They cover logic and markup, not clicks.

**Local throwaway pages.** `app/console/l0-wallet-test`, `l1-transport-test`, `l2-create-test`, `l3-agents-test` drive the same modules with plain buttons and a log. They are listed in `.git/info/exclude`, never committed, never deleted. They are not part of the product.

---

## 2. How to verify on chain

Read a transaction (replace the hash and signer):

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"<HASH>","sender_account_id":"<SIGNER>","wait_until":"FINAL"}}'
```

Look for `final_execution_status` `FINAL`, `status.SuccessValue`, no `Failure` in `receipts_outcome`, the `method_name`, `deposit` and `gas` of the action, and the `EVENT_JSON` log with `"standard":"aruna"`.

Read a vault with the SDK (from `packages/sdk`, after building):

```js
import { readVault } from "./dist/index.js";
const v = await readVault("<vault>", { network: "testnet" });
// v.owner, v.operator, v.fullAccessKeys, v.ceiling, v.agents[].status, .policyVersion, .policy, .key
```

Read the access keys of an account: RPC `query` with `request_type: "view_access_key_list"`. Read a balance: `view_account`.

Useful facts when judging a result:

- Methods that attach exactly 1 yoctoNEAR: `add_agent`, `update_policy`, `resume_agent`, `set_operator`, `set_ceiling`, `withdraw_to_owner`. `pause_agent` and `revoke_agent` attach 0. So a vault balance drifts up by 1 yocto per such call.
- `policyVersion` goes up on every policy change, tighten or loosen.
- Changing the ceiling does not rewrite an existing agent's policy.
- A vault with a key it does not know shows it in `unknownKeys`. It should always be empty, and `fullAccessKeys` should be 0.

**Scripted chain run.** Every call the screens make can be driven without a browser: build `OwnerVault` and `OperatorVault` from `@aruna/sdk/vault` over `nearApiTransport` with a throwaway account (implicit account id = hex of the public key, funded by one transfer). Keep the key file outside the repo. The run in section 5 did exactly this. It proves the contract and SDK behaviour, not the screens.

---

## 3. L1: wallet transport and transaction preview

Plan unit U4. Needs a connected wallet. Automated coverage: `wallet-transport.test.ts`, `tx-status.test.ts`, `history.test.ts`, `TxDialog.test.tsx`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| L1-1 | Connect a wallet, the account shows in the header, disconnect works | [x] | pasted output of the local L0 page: connected account and balance (L0, see `docs/ILHAM-PLAN.md`) |
| L1-2 | A signed call goes through the transport: `set_ceiling` with exactly 1 yocto from the vault owner | [x] | tx `Axf3JmvfU2R3B1HqEerbR6UnMrbxJXaFoR41zeiEeqzJ`, `FINAL`, event `ceiling_updated` |
| L1-3 | The preview shows signer, receiver, method, deposit (`1 yoctoNEAR`) and gas before the wallet opens | [x] | pasted log of the local L1 page |
| L1-4 | Declining at the preview sends nothing and ends as cancelled | [x] | three `WalletCancelledError` entries in the pasted L1 log |
| L1-5 | The transport refuses any network but testnet | [x] | unit test |
| L1-6 | History states: live, behind (pending rows), unavailable (last known block) | [x] unit tests only | `history.test.ts`. Not seen against a live indexer: the hosted one lagged on 12 November |

Not recorded: which wallet was used for L0 and L1. Only one wallet was tried.

---

## 4. L2: create a vault

Plan unit U5. Route `/console/create/`. Automated coverage: `data/factory.test.ts`, `chain-reads.test.ts`, `wallet-transport.test.ts` (`sendNear`).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| L2-1 | The factory is read (registry, minimum deposit 0.5 NEAR) and classified targets are listed from the registry | [x] | pasted Inspect output of the local L2 page |
| L2-2 | Name checks: format, and "already exists" before the wallet opens | [x] | Inspect output (`taken=false`), then the second Create said "Name taken, nothing sent." |
| L2-3 | Funds plan: a short balance or a deposit under the minimum builds no transaction (AE4) | [x] unit tests only | `factory.test.ts`. Not tried with a short wallet |
| L2-4 | `create_vault` with a ceiling, 150 Tgas, 0.5 NEAR deposit | [x] | tx `HChX9XSWrkLLDcNVtQHLLNE4EQCWWEcsreQAycE7ocAq`, events `vault_created`, `vault_deployed`; vault `l2ocbae`, balance 0.5 NEAR, `fullAccessKeys` 0, owner and operator the wallet |
| L2-5 | Deposit into the vault by plain transfer | [x] | tx `DTGuccdDcTwSK55obPJoWrSQjNkcjjmqFsR7RHJuG2KC`, vault balance 1 NEAR |
| L2-6 | The same flow clicked through the real `/console/create/` screen | [ ] | only the local test page was used |
| L2-7 | The default ceiling contains `swap.arunafi.testnet` | [x] | swap was classified on 12 November (`cd82cba`); a scripted vault was created with a swap-only ceiling: tx `2AeZHniVCZZkwANhrTboX8JeHqJgPz9beJ72twDNUVvZ` |
| L2-8 | A frozen target is not blocked from the picker, only marked | [x] (known gap) | `l2ocbae` was created with `drift-target`, which is frozen; the factory accepted it |

---

## 5. L3: agents and role actions

Plan unit U6. Route `/console/agents/?vault=l2ocbae.factory2.arunafi.testnet`. Connect the wallet first; the header role switch (Client, Operator) only narrows what the wallet may do. Every signed action opens a dialog: the left button is named after the action (for example "Pause agent", "Delete the key", "Save the policy"), the right one is Cancel. After the wallet signs, the dialog says "Confirmed." with the hash as a link.

Automated coverage: `agent-keys.test.ts`, `agent-actions.test.ts`, `data/agent-draft.test.ts`, `data/ceiling.test.ts`, `ui/LiveAgentsTable.test.tsx`.

### 5.1 From the screens, real wallet

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| T1 | Ceiling panel: add `swap.arunafi.testnet` with Check, then Save the ceiling | [x] | tx `8tAx6aE6Pr5VJVmJT9ndQWYbBjnP1TM7dxhiLc5DH1gN`: `set_ceiling`, deposit 1 yocto, targets `drift-target` then `drift-target` and `swap`. Limits, allowance and risk class unchanged. Existing agents' policies unchanged |
| T1b | Ceiling negatives: no target keeps Save disabled; a target without a registry class is refused; an existing target says "Already in the list." | [ ] | not reported |
| T2a | Pause `arunaTest#1` from the list | [x] | tx `EnN4nyZJ89b76cT3CkLpyWMMc5LGNkkiVfMMCE1MyjMa`: `pause_agent`, deposit 0, event Active to Paused |
| T2b | As Operator, Resume is disabled with "only the owner can resume an agent" | [x] | pasted table output |
| T2c | Resume `Ciz1uYRC...` (owner) from the list | [x] | tx `DYPDEnTnxmALhemqZzV2erBUBxwryrw4jPERPRS5P44D`: `resume_agent`, deposit 1 yocto, event Paused to Active |
| T2d | Resume `arunaTest#1` (owner) from the list | [x] hash not recorded | chain: `arunaTest#1` is Active again and the vault balance rose by 1 yocto |
| T2e | Pausing, then cancelling in the wallet: "Cancelled. Nothing was sent.", status unchanged | [ ] | not reported |
| T3a | Agent detail, Policy tab: tighten from the screen (Daily cap 0.4 to 0.2 on `arunaTest#1`) | [x] tighten, hash not recorded; loosen back not done | chain read of 12 November: `arunaTest#1` `policyVersion` 2, `dailyCap` 0.2 NEAR. The planned Max per transaction change was not the one made |
| T3b | Policy as Operator: loosening is disabled with "An operator can only tighten a policy." | [ ] | unit test only |
| T3c | Policy values above the ceiling or a per-transaction limit above the daily cap are refused before the wallet opens, naming the field | [ ] | unit tests only (`agent-actions.test.ts`) |
| T3d | Add `swap.arunafi.testnet` to an agent's allowed targets | [ ] | all agents still allow only `drift-target` |
| T4a | Create an agent: wizard, 4 steps, label, limits, class `global_by_account`, targets, review, `add_agent` | [x] hash not recorded | agent "export key" (`ed25519:52K73tF3iznRtobTZfSPChx3g5qRbEvnzEoVaG95xys4`) exists with policy 0.1/0.4 NEAR, key limited to `spend` and `refresh_class`; `arunaTest#1` was made the same way earlier |
| T4b | Export the key: the file has the label, network, vault, public key and the private key | [x] | pasted file; the private key matches the public key (checked with near-api-js) |
| T4c | Revoke the new agent: status Revoked, column Key "Deleted", no buttons | [x] hash not recorded | chain: status Revoked, the key is gone from the account's access keys |
| T5 | Funds tab: deposit 0.1 NEAR and withdraw 0.1 NEAR to the owner from the screen | [ ] | vault balance only moved by the 1 yocto attached to other calls, so no net deposit or withdraw from the screen is visible |
| T6 | Operator panel: invalid or same account is refused; set another operator; remove; restore | [ ] | operator is still the original |
| T7 | Private window: an agent whose key is not stored shows "Not in this browser", Pause and Revoke stay enabled (AE5) | [ ] | unit test only |

### 5.2 Scripted chain run (no browser)

Throwaway account `434401c8f270e164674d6cfdd3057282a2505734bf7d07e2256eedfca935a0c5`, funded by `strongpuma8118.testnet` (tx `7UceyRo4XQNDA3rehvYkqntvcUsRzMt3FmSBGtcSQpZz`, 5 NEAR). It drove the same SDK clients and the same argument shapes as the screens, against a new vault `l3tjrlou.factory2.arunafi.testnet` with a swap-only ceiling.

| ID | Scenario | Result | Evidence (tx) |
|---|---|---|---|
| S1 | Create a vault: owner and operator the account, `fullAccessKeys` 0 | [x] | `2AeZHniVCZZkwANhrTboX8JeHqJgPz9beJ72twDNUVvZ` |
| S2 | Add an agent: Active, methods `spend,refresh_class`, receiver the vault | [x] | `DctULbjo2pFmvMScYsENETdBDxW8WTuriNGbUrtfU1je` |
| S3 | Pause, then resume as owner | [x] | `9gZBiSuhXarUSKvEVN7aRRPM3QTBbDq9p4aAJ4K3jnyZ`, `GYka9c9EQBUBEAZqCc4Y5bzHJm3ea8b9NVH85RwANh9z` |
| S4 | Tighten to 0.05 (version 1 to 2), loosen to 0.1 (version 2 to 3) | [x] | `EAx3MLPCdksXN2uZK9hobqxi9izUoTJLjWv8LYoy2xVo`, `AiGjScSPL8bRm4Emm3Y4DpGFN6VdyunYLjJZ5bnP1qqi` |
| S5 | A policy above the ceiling is refused by the vault with `ARUNA_OVER_CEILING` | [x] | no transaction; the call panicked with that code |
| S6 | Deposit 0.1 NEAR by transfer, then withdraw 0.1 to the owner | [x] | `6rS5TCf3ejZy8mXi1jsvnyYDn8EByX9TwujY8Z2U2SPQ`, `3t7VwqRJbyzctrpaySUKzq7gewjsbwHQSrVpbV1JBQyo`. The withdraw lowers the balance by 0.1 NEAR minus 1 yocto, because the call attaches 1 yocto that stays in the vault. A check that demanded exactly 0.1 reported a false failure |
| S7 | Set the operator to another account, remove it, set it back | [x] | `AdboEmVzSaaU4ibDrdyZ1G3KDvMATWVYCHK43NxJVUsv`, `2mpi9woLBLgrcbypGBcdjMUP9ov94N2bzWYxVizHRPEw`, `EVHoE1xueWf3yoxwenrDxTu3GTKeNDbB8FAvwJBGW52D` |
| S8 | Change the ceiling (add `drift-target`, class rises to `global_by_account`), then restore it. The existing agent's policy and status did not change | [x] | `6oUB6FRRE9smJFNCU5Gnb47h6TXsiLkQ4xrgNQyFu6FH`, `5GjE8yLrxozGWQxU8bRNZNpvPXvZZDm9Qn4VuycP7ZqR` |
| S9 | Revoke the agent: status Revoked, its key is gone from the account | [x] | `23RBoPnmaDTjwbEqh3ktFVuP59Ck2G4xjv9riXAwRUYW` |

---

## 5b. L4 and L5: playground, activity, overview

Routes: `/console/playground/?vault=<id>`, `/console/dashboard/?vault=<id>` (the Overview), and the Activity tab of `/console/agents/detail?agent=<key>&vault=<id>`. History comes from `NEXT_PUBLIC_INDEXER_URL`; without it the recorded sample is shown and labelled.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| P1 | Injected scenario on an agent whose own list holds the swap: five refusals (`TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`), then Paused, auto-disabled, sixth attempt not sent | [x] | pasted screen output of 12 November on `l2ocbae`; also by script on `l3tjrlou` (add_agent `J4rMRqbDG7sMmfW1eginoVPMR4k99dnbnREcAwoR5LdB`, refusals `CVF8NVfbfY8DqWqmwkmQLvpJwKgneMxuFG6isQk9dMy3`, `ZdN6QWgk6iShf72H7G6ngVDecdmkqpdxXdpSRpmypAf`, `AvKHKNemzcwUM5A1D8qqkcSw8BPny8noYeKwHeY1eYZG`, `FPQ1uvRNKy2CNxhh6Sne22G6E8EysPDTiBxYUMSuwazF`, `GaKPcZq3VFGKZmL58ri9BBXLFQeaa5okwYrs11suyGsZ`) |
| P2 | Honest scenario: one in-policy swap settles, agent stays Active | [x] hash not recorded | pasted screen output |
| P3 | Agent whose list lacks the swap: the fifth check fails with a link to the agent | [x] | the first run showed `TARGET_NOT_ALLOWED` on every swap; the check was added after |
| P4 | Stop pressed mid-run sends no further attempt | [ ] unit test only | `data/playground.test.ts` |
| P5 | Reload mid-run shows "A previous run was interrupted" with the on-chain status | [ ] unit test only | `data/playground.test.ts` |
| A1 | After a P1 run, the agent Activity tab lists each refusal with reason, class at refusal and a transaction link within one minute | [ ] | needs a healthy indexer |
| A2 | Overview shows tiles, agents, contracts touched, exposure history and recent activity for a vault | [x] tiles, agents and contracts read from the chain; the two history panels showed the "History is not connected" message, since no indexer URL was set | pasted screen output of 12 November on `l2ocbae` (1 of 2 active, 0.9928 NEAR, exposure 0.2 NEAR at `swap.arunafi.testnet`, class `local_upgradeable`) |
| A3 | With the indexer unreachable, the Overview totals still render and history says "unavailable since block N" | [ ] unit tests only | `ui/History.test.tsx`, `data/overview.test.ts` |
| A4 | An exposure row shows the class recorded with it, which may differ from the target's class today | [ ] unit test only | `ui/History.test.tsx` |

### Policy price (L5, second half)

Open the agent detail Policy tab: `/console/agents/detail?agent=<key>&vault=<id>`. The "What this policy costs" panel asks `pool2.arunafi.testnet` for each allowed target.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| C1 | Panel shows, per allowed target, the price on chain and the draft price, the draft labelled "proposed, not yet signed", and "Testnet, assumed numbers" | [x] | pasted screen output of 12 November on `l2ocbae`, agent with `drift-target` (class `global_by_account`): both columns 1.3325 NEAR with no change, can pay out up to 9.92 NEAR (0.4 NEAR x 31 days x 80%) |
| C2 | Editing Daily cap moves the draft premium within about a second, nothing signed | [x] indirect | the intermediate screen was not pasted; the saved result matches the predicted draft (0.4 NEAR cap 1.3325 NEAR, 0.2 NEAR cap 0.6662 NEAR, payout 9.92 then 4.96 NEAR) |
| C3 | Same cap change against the real pool by script: 2 NEAR gives 3.5877 NEAR, 1 NEAR gives 1.7939 NEAR, reachable payout bound by the cap, limit 64 NEAR | [x] | script run of 12 November on `l2ocbae`, agent `arunaTest#1`, target `swap.arunafi.testnet` |
| C4 | Daily cap 0 shows "Not priced: a daily cap of zero leaves the exposure unbounded" for the draft, not a price | [x] by script and unit test | script run of 12 November; `data/price.test.ts` |
| C5 | A class ceiling below the target's class shows "Not allowed: this draft's class ceiling excludes the target" | [x] by script and unit test | script run of 12 November; `data/price.test.ts` |
| C6 | After Save the policy is signed, the on-chain price equals the draft price shown before | [x] hash not recorded | pasted screen of 12 November: "No change from the current policy", On chain now = Draft = 0.6662 NEAR, payout 4.96 NEAR, Daily cap 0,2; chain read: `arunaTest#1` `policyVersion` 2, `dailyCap` 0.2 NEAR, Active |

## 5c. F1 by script (L6)

The console's whole first flow, driven by a script with the same modules the screens use (`createVaultArgs`, `buildCeiling`, `classifiedTargets`, `generateAgentKey`, `draftToPolicy`, the Playground's checks and `runAttempts`), from a throwaway account, on 12 November 2026. It is a chain proof, not a wallet run: nobody clicked a screen, and the wallet prompt was not part of it. Vault `f1pbr5p.factory2.arunafi.testnet`, owner and operator the throwaway account.

| ID | Step | Result | Transaction |
|---|---|---|---|
| F1-1 | `create_vault` with a ceiling of `swap.arunafi.testnet` (class `local_upgradeable` from the registry), deposit 1 NEAR | [x] | `Msk9MYW7RHHDpr8bNejGG2uhdvg4e51ErY54PuiHsXB` |
| F1-2 | Add an agent allowed to call the swap; five pre-run checks Ready | [x] | `3D4rqmUowjZsfrmktiwEayPvnZbBuhCoUueU1CuJUYEK` |
| F1-3 | Honest scenario: one swap of 0.1 NEAR, Settled, agent still Active | [x] | `9ogGGWj3T1aNBtfkaDvdbkN4utkPtYxQiDLucP9nRif2` |
| F1-4 | Tighten Daily cap 0.4 to 0.2 NEAR; `policyVersion` 1 to 2 | [x] | `9uRdLXuRYU3dfKDA2KRxGVyphPCs6SUyFw8SN1yDt1K2` |
| F1-5 | Injected scenario: `TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`; sixth not sent; agent Paused, `auto_disabled` true | [x] | `AYrRFG5kr4nUk3Ptpvvb1BpAgimB1adb6c9B2J8vq5Nh`, `EsvLAuGQ7jh4fKtDJHztQxADZ5GcB3DUp7ydsNNjT7Rm`, `fJEGUuexAmCQnzkBMjFCJ2jybfZ9ncbGwt89eKBovLb`, `4z31Cg3oZKM9qSpbARKJ3R3QWHGYfLyaAeHsfHsW7Cei`, `7t8n3b1uhUc4kybcURHeGUf2BKDYGD31eF74iLEUjTxg` |
| F1-6 | Final read: `fullAccessKeys` 0, recorded exposure 0.1 NEAR at `swap.arunafi.testnet` (`local_upgradeable`), daily cap 0.2 NEAR | [x] | `readVault` |

Check it yourself: `node fixtures/tools.mjs view f1pbr5p.factory2.arunafi.testnet get_agents '{}'`. The F1 run by a person with a fresh wallet, on screens, for the demo video, is still to do.

## 6. Gaps and gotchas

- **Unproven from the screens (L3):** T1b, T2e, T3a loosen, T3b to T3d, T5, T6, T7. Their chain behaviour is proven by S4 to S8; only the screen wiring is not.
- **Not tested at all:** the real `/console/create/` screen (L2-6); any wallet other than the ones used; the indexer-backed Activity tab against a healthy hosted indexer.
- **Frozen targets** can be chosen in the creator, the wizard and the policy editor. They are only marked.
- **A frozen or unclassified target in an old ceiling:** the Ceiling panel drops a target that has no registry class on save and says so.
- **The gas allowance** of an existing key cannot be changed from the console; the SDK has no method for it.
- **A hosted indexer** exists (`aruna-near-indexer.up.railway.app`) but was catching up by about 360 thousand blocks on 12 November. Until it is healthy, history is the recorded fixture and is labelled.
- **Edits that fail silently:** several scripted text replacements during L3 changed nothing and printed nothing. After any scripted edit, grep for the new text. A bad replacement once duplicated a whole file; restore from git and redo it with the Edit tool.
- **Private keys in chat:** an exported agent key was pasted into a chat. It was revoked, so it is harmless, but do not paste a live key.
- **Dialog wording:** the confirm button is named after the action, not "Confirm". Tell testers the real name.
