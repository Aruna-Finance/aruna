# Ilham's plan: lane B (console, live)

This is Ilham's scope in `docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md`. It is lane B: the console stops using mock data, signs through the connected wallet, and reads history from Aris's indexer. Aris owns lane A (indexer, contracts, CLI, `@aruna/sim`). Two items below reach into lane A files (`examples/` in L4, `packages/sdk/src/coverage/quote.ts` in L5). The plan assigns both to Ilham (U7, U8), but tell Aris before touching them.

The plan file is the authority for requirements (R-numbers), decisions (KTD-numbers) and acceptance examples (AE-numbers). This file only orders the work and says when each phase is done.

**Cut:** 13 November 2026, 23:59 UTC+7. Whatever state F1 is in then, the remaining time goes to the submission checklist (L6). Deadline: 14 November 2026, 23:59 UTC.

**Rules that bind every phase:** testnet only and no signing on mainnet (R12); the console never reimplements a classification check (CLAUDE.md rule 10); a policy refusal is shown as an outcome with its reason code, an authorization failure as a failure (R14); no agent key and no console path gives a free-form call (rule 5); never write "trustless"; no keys or `.env` in the repo; no em dash in copy.

**Working method:** one branch and one PR per phase, branch named `feat/console-<topic>` (for example `feat/console-wallet-transport`), the same style as `feat/indexer`. Each phase ends with typecheck, tests and `pnpm build` green, the README step for it written as "do X, see Y", and a line in the change log of `docs/UI-PLAN.md`. A mock adapter is deleted in the phase that makes its screen live (KTD12).

---

## Phase map

| Phase | Plan unit | Title | Needs | Target |
|---|---|---|---|---|
| L0 | none | Prove the wallet and the SDK in a browser | nothing | 11 Nov |
| L1 | U4 | Wallet transport, transaction preview, history client | L0 | 11 to 12 Nov |
| L2 | U5 | Create your own vault | L1 | 12 Nov |
| L3 | U6 | Agents and role actions | L2 | 12 Nov |
| L4 | U7 | Playground, live | L3 | 13 Nov |
| L5 | U8 | Activity, exposure, policy-to-price | L4 for actions; U3 (hosted indexer) for live history | 13 Nov |
| L6 | U9, U10 | Deploy, README F1, live run, submission | L5 and Aris | 13 Nov cut, then 14 Nov |
| L7 | U11 | Coverage and claims, live | L5 | after v0 |
| L8 | U12 | Pool and underwriter, live | L5 | read-only half done 13 Nov; deposit and withdraw 14 Nov (`docs/plans/2026-11-14-1453-feat-underwriter-console-flow-plan.md`); per-class books after v0 |
| L9 | U13 | Targets and attestor, live | L5 | done 13 Nov (read-only) |
| L10 | U19 | Agents brought from the CLI or MCP | L3 | after v0 |
| L11 | U16 | Migration in the console | Aris U15 | plan checked in the console, run from the CLI (13 Nov) |
| L12 | U18 | Simulation on published output | Aris U17 | done 13 Nov (branch `feat/console-simulation-published`) |
| L13 | U20 | Phase 2 docs and README steps | L7 to L12 | after v0 |

L1 to L4 are a chain. The UI parts of L5 (activity list, exposure history, the draft policy panel) can be built against `apps/web/src/console/data/indexer-fixture.ts` while L3 and L4 wait on a wallet, so start them in the gaps.

---

## v0

### L0. Prove the wallet and the SDK in a browser

Why first: L1 to L5 assume things the docs do not prove. If either fails, the plan changes, so find out before building screens.

- [x] Read `packages/sdk/src/vault/near-transport.ts` and `transport.ts` (`CallResult`, `ArunaAuthError`, `ArunaRpcError`) so the wallet transport maps outcomes the same way
- [x] (build and prerender pass; `nearApiTransport` was not run in a browser, only built. `near-api-js` is not a dependency of `apps/web` yet: add 7.4.0 in L3 when browser key generation lands) Add a throwaway page (not committed) that imports `@aruna/sdk/vault` and `near-api-js`, and confirm `pnpm build` of `apps/web` succeeds and the bundle loads in the browser
- [x] (done in L1 with `set_ceiling`, see the L1 status) Ilham sends one real 1 yoctoNEAR call from a testnet wallet through `signAndSendTransaction` (for example `set_ceiling` with the current ceiling on a test vault). `pause_agent` attaches no deposit and proves nothing here
- [ ] (partly: transaction recorded below; the wallet name was not recorded) Record the transaction link, the wallet used, and whether the deposit was attached
- [ ] Agree with Aris who hosts the indexer and holds the FastNear key (never in the repo), and write the answer in the change log

Done when: one explorer link shows the 1 yocto deposit, and the SDK vault entry builds in `apps/web`. If the deposit is not attached by the wallet, stop and report (plan stop condition).

**Result (11 November 2026).** A local, uncommitted test page connected a testnet wallet through `@hot-labs/near-connect` and called `create_vault` on `factory2.arunafi.testnet` with a 0.5 NEAR deposit and 150 Tgas. Read back from the testnet RPC: transaction `EBfGA31yfoA5JWwEtADa4u5VL5AY1DtbLk1vFZAeaWjH`, final status `FINAL` with `SuccessValue`, attached deposit `500000000000000000000000`, events `vault_created` (factory) and `vault_deployed` (registry), and the vault account `tmlaqd5.factory2.arunafi.testnet` exists with 0.5 NEAR. Explorer: https://testnet.nearblocks.io/txns/EBfGA31yfoA5JWwEtADa4u5VL5AY1DtbLk1vFZAeaWjH. So the wallet attaches a deposit on testnet for one wallet. Still open: a call with exactly 1 yoctoNEAR (`set_ceiling` on that vault, owned by the wallet) and the name of the wallet used.

### L1. Wallet transport, transaction preview, history client (U4)

Requirements: R9 to R14. Files under `apps/web/src/console/`.

- [x] `wallet-transport.ts`: `VaultTransport` over `@hot-labs/near-connect`: `call` as one function-call action, `view` and `account` over `@aruna/rpc`, outcome mapped to `CallResult` with receipts keyed by executor, `Failure` to `ArunaAuthError`, a rejected wallet promise to a cancel, mainnet throws before any prompt
- [x] (exposes `getWallet()`; the connector itself stays private) `WalletContext.tsx`: expose the connector for signing
- [x] `ui/TxDialog.tsx`: show method, receiver, deposit, gas before the wallet opens; pending, confirmed (explorer link) and failed after signing; keep the cancel case
- [x] (default is the recorded fixture, labelled "fixture", until `NEXT_PUBLIC_INDEXER_URL` is set) `history.ts`: the `@aruna/indexer/client` plus three states: live, behind (poll until the tab's own transaction is indexed, keep it as a pending row), unavailable since block N
- [x] (as `historyNotice` text; no screen uses it yet) `ui/Freshness.tsx`: show the state and the last indexed block
- [x] (`@aruna/indexer` was already a dependency; the boundary test needed no change) Add `@aruna/indexer` client to `apps/web` and widen the boundary test only as far as needed (client entry, never server code)
- [x] Tests: two-receipt outcome mapping; failure vs cancel; mainnet refusal; `withdraw_to_owner` preview shows 1 yocto and the vault as receiver; network error gives "unavailable" with the last known block (AE2); refusal rendered as outcome not toast; behind state keeps the pending row

Done when: a connected testnet wallet pauses an agent on a test vault from the console and the transaction is on the explorer.

**Status (11 November 2026).** Done. The modules and their tests are in (`wallet-transport.ts`, `tx-status.ts`, `history.ts`, `TxDialog.tsx`). A local, uncommitted test page sent `set_ceiling` through `createWalletTransport` and `OwnerVault` from a connected testnet wallet. Read back from the testnet RPC: transaction `Axf3JmvfU2R3B1HqEerbR6UnMrbxJXaFoR41zeiEeqzJ`, final status `FINAL` with `SuccessValue`, signer the wallet, receiver `tmlaqd5.factory2.arunafi.testnet`, method `set_ceiling`, deposit `1` yoctoNEAR, gas 30 Tgas, event `ceiling_updated` (before equal to after). The preview showed `deposit=1 yoctoNEAR` before the wallet opened. Declining at the preview was tried three times: `WalletCancelledError`, nothing sent. Explorer: https://testnet.nearblocks.io/txns/Axf3JmvfU2R3B1HqEerbR6UnMrbxJXaFoR41zeiEeqzJ. The plan said "pauses an agent", but the vault has no agent yet, so `set_ceiling` was used; it also needs exactly 1 yoctoNEAR and owner rights. Not yet done: no screen uses the transport (L2 onward), the wallet name was not recorded, and only one wallet was tried.

### L2. Create your own vault (U5)

Requirements: R11, R15 to R17; AE4.

- [x] `data/factory.ts`: read the factory's minimum deposit, build `create_vault` (`name`, `owner`, `operator`, `ceiling`), check a duplicate name before signing
- [x] `screens/CreateVault.tsx`: total needed = minimum deposit + vault deposit + gas, balance check; if short, show the shortfall and a faucet link and send nothing
- [~] Ceiling picker lists only targets with a registry class, each with its class and evidence one click away. NOT MET: default ceiling cannot contain `swap.arunafi.testnet` because registry2 has no class for it (needs Aris)
- [x] Deposit NEAR into the vault as a previewed plain transfer
- [x] Setup checklist derived from chain state (created, ceiling set, funded, first agent added), resuming at the first step not done
- [ ] `useVault.ts`: live `readVault`; `walletRole.ts`: role from the vault's on-chain owner and operator; the wallet's vault list from the indexer (`vaults?owner=` and `?operator=`)
- [ ] `nav.ts`: an entry when the wallet has no vault
- [ ] Keep `data/vault-mock.ts` until no importer remains; move `vaultStore` into a story-local fixture because the guided demo keeps its content
- [ ] Tests: short balance builds no transaction (AE4); existing name caught; picker omits unclassified targets; created-but-unfunded vault opens at "fund the vault"; indexer down after creation still opens the vault with "history unavailable"; role is owner and operator when both are the wallet, neither for a stranger

Done when: a fresh testnet wallet creates a vault, sets a ceiling containing `swap.arunafi.testnet`, deposits NEAR and sees the balance.

**Status (11 November 2026).** Partly done. With a connected testnet wallet, a local test page created `l2ocbae.factory2.arunafi.testnet` (tx `HChX9XSWrkLLDcNVtQHLLNE4EQCWWEcsreQAycE7ocAq`, `FINAL`, `vault_created` and `vault_deployed` events, 150 Tgas, 0.5 NEAR) and deposited 0.5 NEAR by plain transfer (tx `DTGuccdDcTwSK55obPJoWrSQjNkcjjmqFsR7RHJuG2KC`, `FINAL`). Read back from the RPC: balance 1 NEAR, no full-access key, owner and operator the wallet. Not met: the ceiling could not contain `swap.arunafi.testnet`, because registry2 has no class for it (only the frozen `drift-target.arunafi.testnet` is classified); needs Aris. Open: live `useVault.ts`, the nav entry for a wallet with no vault, mock cleanup, and the indexer-down and role tests. The real `/console/create/` screen was not clicked through yet; the test page used the same modules.

### L3. Agents and role actions (U6)

Requirements: R18, R20, R21, R23; AE1, AE5.

- [x] `agent-keys.ts`: generate an ed25519 keypair in the tab, store under network + vault + public key in `localStorage` (try/catch every access), label "testnet agent key, limited to this vault", export as a download
- [x] `AgentWizard.tsx`: register the public key through `OperatorVault.createAgent`; default policy that makes the shared injected attempts return their recorded reason codes; refuse a policy outside the ceiling before signing, naming the field
- [~] `AgentDetail.tsx`, `AgentsList.tsx`, `useActions.tsx`: built as `useLiveActions.tsx` and live screens, including set or remove operator and change ceiling (`LiveVaultSettings.tsx`); old `useActions.tsx` stays for the mock screens. Browser-checked: list, wizard, key tab. Not yet checked on chain from the screens: policy, funds, operator, ceiling: pause, revoke, tighten for the operator; resume, loosen, set or remove the operator, change the ceiling, withdraw for the owner (`OwnerVault`); a disabled action carries its reason
- [~] When one wallet is both owner and operator, `RoleContext` lets the visitor view as the operator and see "resume" disabled with "only the owner can resume an auto-disabled agent"
- [x] An agent whose key is not in this browser is marked "key not in this browser" (revoke stays available)
- [ ] Remove the agent part of `data/mock.ts`: NOT done. The mock vault still feeds Overview, Migration, Story, TargetDetail and Coverage, so it goes with those screens
- [~] Tests: key stored per vault and network, not leaked across networks; AE1 operator vs owner resume; operator cannot loosen, withdraw or change the owner; AE5

Done when: on a self-serve vault an agent is added with a browser key, paused, resumed by the owner and revoked, and each change shows on chain.

**Status (11 November 2026).** Built, closed with open verification. Every feature in this phase is in: browser keys, the live Agents list, the Create an agent wizard, agent detail (overview, policy, activity, funds, key and proof) and owner settings (operator, ceiling). Proven on testnet, read back from the RPC: add agent from the wizard (`arunaTest#1`, function-call key limited to `spend` and `refresh_class`, no full-access key); add, pause, resume (owner) and revoke through the local test page (txs `26pTkpwesbRzVbM1mLMtrcfszdYXV7pRjtRHHsTs9Aa9`, `EuFbgd9DSgx73N8DKL3JWNuvtvhfP3hAUCs2yJmcNwHT`, `5EeCP3hTVJyQrFY5b8EzJFVjvTCUq7JNS1NzXeiFgxeb`, `3L5WAm1RhWCo67237sQoC3Senycnooxaxz11bsyjdTch`, `AhdTr93Jibpjo2M8fFmC2pYq3Ai1pbnfBaC66ZJAmUEG`). Checked by eye only, no transaction hash: role switch with reasons on disabled buttons, the key and proof tab. **Proven on chain by a script with a throwaway account (same SDK clients and argument shapes as the screens), vault `l3tjrlou.factory2.arunafi.testnet`, 12 November:** create vault with a `swap.arunafi.testnet` ceiling (`2AeZHniVCZZkwANhrTboX8JeHqJgPz9beJ72twDNUVvZ`), add agent (`DctULbjo2pFmvMScYsENETdBDxW8WTuriNGbUrtfU1je`), pause (`9gZBiSuhXarUSKvEVN7aRRPM3QTBbDq9p4aAJ4K3jnyZ`), resume (`GYka9c9EQBUBEAZqCc4Y5bzHJm3ea8b9NVH85RwANh9z`), tighten (`EAx3MLPCdksXN2uZK9hobqxi9izUoTJLjWv8LYoy2xVo`), loosen (`AiGjScSPL8bRm4Emm3Y4DpGFN6VdyunYLjJZ5bnP1qqi`), a policy above the ceiling refused with `ARUNA_OVER_CEILING`, deposit (`6rS5TCf3ejZy8mXi1jsvnyYDn8EByX9TwujY8Z2U2SPQ`), withdraw to owner (`3t7VwqRJbyzctrpaySUKzq7gewjsbwHQSrVpbV1JBQyo`), set, remove and restore the operator, change the ceiling and restore it (the existing agent policy did not change), revoke (`23RBoPnmaDTjwbEqh3ktFVuP59Ck2G4xjv9riXAwRUYW`, key gone from the account). Also from the screens with a real wallet: `set_ceiling` adding swap (`8tAx6aE6Pr5VJVmJT9ndQWYbBjnP1TM7dxhiLc5DH1gN`), pause (`EnN4nyZJ89b76cT3CkLpyWMMc5LGNkkiVfMMCE1MyjMa`) and resume (`DYPDEnTnxmALhemqZzV2erBUBxwryrw4jPERPRS5P44D`). The script does not click the screens, so the dialogs, the wizard and the export download are still checked by hand. **Not proven on chain from the screens:** pause, resume and revoke from the list; tighten and loosen policy (all agents still show policy version 1); deposit and withdraw; set or remove the operator; change the ceiling; the wizard export-key download; the "Not in this browser" view in a private window. These pass unit tests and the build only. The sample agent list, wizard and detail were removed; the mock vault store stays because Overview, Migration, Story, TargetDetail and Coverage still read it, so "remove the agent part of data/mock.ts" is not done. The gas allowance of an existing key cannot be changed from the console: the SDK has no method for it.


### L4. Playground, live (U7)

Requirement: R22; KTD8. Touches `examples/`, which Aris also uses (`coverage-demo.ts`, `injected-agent.ts`). The plan assigns `examples/scenarios.ts` to Ilham (U7); tell Aris before editing the two agent files.

- [ ] `examples/scenarios.ts`: the injected attempts and the honest swap, defined once; `examples/injected-agent.ts` and `honest-agent.ts` import it; export from `examples/package.json`; the recorded run in `examples/README.md` must still reproduce
- [ ] `screens/Playground.tsx`: build `AgentVault` with `nearApiTransport`, vault as signer and the stored key; run attempts one at a time with queued, sending, outcome; stop at `agent_auto_disabled` and show the new state from `readVault`; Stop button halts before the next attempt
- [ ] Pre-run checks with reasons and fix links: agent active, key in this browser, swap target in the ceiling, enough vault balance
- [ ] After a reload mid-run: "previous run interrupted" with the on-chain status
- [ ] Tests: attempt order equals the recorded run; AE1 with stubbed recorded refusals ends "paused, auto-disabled"; an auth error (such as an exhausted allowance) is a failure and stops the run; no agent offered without its key; missing swap target blocks the run; Stop sends no further attempt

Done when: on a self-serve vault the injected scenario ends with the agent `Paused` and `auto_disabled: true` on chain, and `examples/injected-agent.ts` still reproduces its recorded run.

**Status (12 November 2026).** Screen built and run in a browser. `playground-scenarios.ts`, `playground-checks.ts`, `playground-run.ts`, `Playground.tsx` and 15 tests are in; `examples/` is untouched, so the shared `examples/scenarios.ts` and the two agent files are still open and need Aris first. Proof on testnet by script, using the same runner and the SDK `AgentVault` (not the screen): on vault `l3tjrlou.factory2.arunafi.testnet` a new agent (add_agent `J4rMRqbDG7sMmfW1eginoVPMR4k99dnbnREcAwoR5LdB`) passed the four checks, five attempts were refused and returned (`TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`; tx `CVF8NVfb...`, `ZdN6QWgk...`, `AvKHKNem...`, `FPQ1uvRN...`, `GaKPcZq3...`), the run ended `auto_disabled`, the agent read `Paused` with `autoDisabled` true, and the sixth attempt was not sent. The agent was revoked afterwards (`2mPBrTTTfnMkf3kZAp3JXTpQL5CJ26WWHA8FiqhLHzGM`). An earlier identical run lost its output and left a second agent, also revoked. Screen run by Ilham on 12 November 2026 on `l2ocbae.factory2.arunafi.testnet` (hashes not recorded): a first run showed `TARGET_NOT_ALLOWED` on the swap attempts because the agent's own list lacked `swap.arunafi.testnet`; the pre-run checks only looked at the ceiling. A fifth check (swap on the agent's allowed targets, with a link to the agent) was added. After the owner added the swap to the agent's policy: the honest scenario ended `Settled` with the agent still Active, and the injected scenario gave `TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`, then `Paused, auto-disabled`, with the sixth attempt not sent. Not shown: Stop, the interrupted notice, and `examples/` (scenarios.ts and the two agent files wait on Aris).

### L5. Activity, exposure and policy-to-price (U8)

Requirements: R24, R25, R27; AE2, AE3. R26 moves to L7.

- [ ] `ui/ActivityList.tsx`, `ui/ExposureHistory.tsx`: rows from the history client; a refusal shows reason code, class at refusal and its transaction link; an exposure row shows the class recorded with it; says exposure is what was sent, not the value of a position
- [ ] `Overview.tsx`, `AgentDetail.tsx` activity tab; totals from `readVault` still render when history is unavailable (AE2)
- [ ] `packages/sdk/src/coverage/quote.ts`: optional proposed policy (daily cap, riskiest class) passed to the pool's own `quote` view, so no pricing arithmetic moves into the SDK or the browser; a proposed class is a filter over registry classes. Touches the SDK (lane A). The plan lists it under U8 (Ilham); tell Aris before editing.
- [ ] `ui/PolicyFields.tsx`, `pricing.ts`: edit a draft, show on-chain and draft quotes side by side with the draft labelled "proposed, not yet signed", debounced; declared defaults shown as assumptions; default limit set above `daily cap x days x ratio` so the premium follows the cap; "testnet, assumed numbers" on every quote (R27); "Apply" sends the tighten call through the preview
- [ ] `pricing.ts` stops computing premiums itself
- [ ] Tests: `packages/sdk/test/coverage-quote.test.ts` (proposed cap passed to `quote`, equals the pool's result); AE3 cap 2 to 1 NEAR lowers the draft premium before signing and the on-chain quote then matches; payout bound by the cap at both caps; a quote refused by the pool (zero cap) is an outcome with its reason; AE2 with history unavailable

Done when: after an L4 run the vault's activity lists each refusal within one minute, and the draft premium moves when the cap changes.

**Closed on 12 November 2026 with open items.** Everything buildable on our side is in; what is not proven, and why:

- **Each refusal in Activity within one minute (A1, the done-when).** The hosted indexer (`aruna-near-indexer.up.railway.app`) answers but is stopped at block 277,003,378, about 370,000 blocks behind (`healthy: false`, `catching_up`, same numbers across minutes). The vault `l2ocbae` was created at block 277,224,925, past that cursor, so its activity is empty. Cause measured on 12 November: the cursor is outside dRPC's window (it served block 277,180,000 but not 277,100,000), the QuickNode key is out of credits (a second key tested the same day answered "daily request limit reached"), and the keyless NEAR archival fallback took about 7 seconds per block. Waiting on Aris: restart the indexer from a block near 277,200,000 so dRPC can serve it, or a new QuickNode key. The window slides about 60 blocks a minute, so the vault falls out of it in roughly 14 hours from 12 November.
- **A3 and A4 (history unavailable, class recorded with an exposure row).** Unit tests only. They need a running indexer to be seen on a page.
- **P4 and P5 (Stop, "previous run was interrupted").** Unit tests only; not tried in a browser. The Playground agent that ran the injected scenario is auto-disabled and needs the owner to resume it before another run.
- **Loosen back from the Policy tab.** Not done; only the tighten (Daily cap 0.4 to 0.2) was run from the screen.
- **`NEXT_PUBLIC_INDEXER_URL` is not set.** Without it the history panels say "History is not connected in this build" instead of showing sample data for a vault it does not hold.
- **The SDK was edited without telling Aris first** (`packages/sdk/src/coverage/quote.ts`, the optional `proposed` policy). The plan assigns it to Ilham (U8) but asks for a heads-up. Aris must be told.
- **`abi-drift` in the SDK fails on this machine** ("stale" generated files I did not touch, probably line endings on Windows). It was failing before this work.

**Earlier status (12 November 2026, second update).** Built; only the indexer part of the done-when is open. The price half is in: `packages/sdk/src/coverage/quote.ts` takes an optional `proposed` policy (daily cap, class ceiling) and passes the cap to the pool's own `quote`, with 4 new SDK tests; `data/price.ts` (declared assumptions: 30 day window, 80% payout ratio, sum insured above what the cap can reach), `quote-live.ts` (prices each target on chain and for the draft), `ui/PriceTable.tsx`, `ui/PricePanel.tsx` (debounced, in the agent Policy tab), and 9 web tests (AE3 included). The old `pricing.ts` is gone from the live path: it moved to `data/story-pricing.ts` and only the guided story uses it. Deviation: the plan's separate "Apply" button is the policy form's existing save button, which already goes through the transaction preview. Proof against the real testnet pool (`pool2.arunafi.testnet`, read only, by script): with the same sum insured, a proposed cap of 2 NEAR quoted a premium of 3.5877 NEAR and 1 NEAR quoted 1.7939 NEAR, reachable payout bound by the cap at both (49.6 and 24.8 NEAR, limit 64), a zero cap came back as `no_daily_cap`, and a class ceiling below the target's as `class_above_proposed`. The numbers are the pool's testnet assumptions. The SDK was edited without asking the other lane first; tell Aris. Run by Ilham in a browser on 12 November: the panel showed both prices and the labels; after Daily cap 0.4 to 0.2 and Save the policy, On chain now equalled Draft (0.6662 NEAR, payout 4.96 NEAR) and the chain read `arunaTest#1` at `policyVersion` 2, `dailyCap` 0.2 NEAR (tx hash not recorded). Still open: the history half needs a healthy indexer, and Stop and the interrupted notice in the Playground are not seen in a browser.

**Earlier status (12 November 2026).** First half built, not yet run in a browser. In: `ui/ActivityList.tsx`, `ui/ExposureHistory.tsx`, `ui/HistoryBlock.tsx`, `useVaultHistory.ts` (reads every 15 seconds), the agent detail Activity tab now uses them and adds an exposure table, and `Overview.tsx` is live (tiles, agents, contracts touched, exposure history, recent activity), with 12 new tests. Totals come from `readVault`, so they render when history is unavailable (AE2). The old mock overview is gone, including its "Cost of protection" drawer, which returns with the price panel. Not started, and it touches lane A: `packages/sdk/src/coverage/quote.ts` (proposed policy), `PolicyFields.tsx`, `pricing.ts`, and the draft-versus-on-chain quote. Aris must be told before `quote.ts` is edited. The hosted indexer was unhealthy on 12 November, so "each refusal within one minute" cannot be shown until it is.

### L6. Deploy, README F1, live run, submission (U9, U10, with Aris)

- [x] Publish `apps/web/out` to Vercel as a static site: https://www.arunafi.xyz/ (13 November 2026). Built without an indexer URL; the build-time `NEXT_PUBLIC_INDEXER_URL` (KTD13) is still to be set once the hosted indexer is caught up (on 13 November it reported `lag_blocks` 261,760, `healthy` false, mode `catching_up`)
- [ ] Run F1 once with a fresh testnet wallet and record every transaction link in `examples/README.md`
- [ ] README: F1 steps as numbered "do X, see Y" with expected results; indexer steps including `rebuild` and its duration (hours); the hosted URLs; update the existing step 5b and 5c wording where mock data is gone
- [ ] `docs/FRONTEND.md`: browser agent keys under R18 (R44). `docs/BUILD-PLAN.md`: stages 5, 6, 8 planned together, v0 status
- [ ] After the cut: submission checklist in `docs/SUBMISSION.md`: `pnpm secret-scan` and a key check over history, public repo, demo video from the F1 run, X post, mainnet payout account, tracks `security`, `agents`, `defi`, `open`, submit before 14 Nov 23:59 UTC
- [ ] If any F1 step is not met, the README and the submission say exactly which one. Do not fake the run

Done when: a Claude Code or Codex run following the README on a clean clone gets every expected result, or the missing step is stated.

**Status (12 November 2026).** Partly done. In: README steps 5e (run an agent from the console), 5f (overview and policy price, with a `quote` command that reproduces the price by hand) and 5g (history, stated as not met), the 5b and 5d wording where mock data is gone, the "In v0" table, `docs/FRONTEND.md` (browser agent keys, R18), `docs/BUILD-PLAN.md` status, and `NEXT_PUBLIC_INDEXER_URL` in `.env.example`. Each new README claim was seen on a screen on 12 November on `l2ocbae.factory2.arunafi.testnet`, or has a command: `get_agents` and `quote` were run against testnet. Not done, and why:

**Update, later on 12 November.** Done since: the F1 flow by script from a throwaway account, with every transaction in `docs/CONSOLE-TESTING.md` section 5c and in README step 5e (vault `f1pbr5p.factory2.arunafi.testnet`); the secret scan, history search and licence check, and a clean clone of `main` (install and build pass; two Windows-only test failures, explained in README step 1), all recorded in `docs/SUBMISSION.md`. Vercel settings for the owner: Root Directory `./`, Application Preset **Other**, Build Command `pnpm --filter "@aruna/web..." build` (it builds the packages the site imports, then the site; run here in about 14 seconds), Output Directory `apps/web/out`, Install Command `pnpm install --frozen-lockfile`, no environment variables until an indexer is live. Unverified: whether Vercel's Hobby plan accepts a repository owned by the `Aruna-Finance` organisation.

- **Publish `apps/web/out` to a static host.** It publishes the site under the owner's account and is outward-facing; it needs the owner to say where (the plan names Vercel). The build itself works (`pnpm --filter @aruna/web build`).
- **Build with the hosted indexer URL.** There is none that works: the hosted indexer is stopped about 370,000 blocks behind, so step 5g stays "not met".
- **Run F1 once with a fresh testnet wallet and record every link in `examples/README.md`.** It needs a fresh wallet and a person at the browser, and `examples/` is the other lane's.
- **`docs/SUBMISSION.md` checklist** (secret scan, public repo, demo video, X post, tracks): after the cut, as the plan says.

**Cut rule (13 Nov 23:59 UTC+7):** stop building; L6 runs from then. If the hosted indexer is not live by 13 Nov midday, record the run against the site as it stands and report the history step as not met.

---

## Remaining before the 14 November deadline (set 13 November 2026)

What is left in lane B that does not wait for anyone. Anything that waits on Aris is in `docs/FOR-ARIS.md`, not here. Order is the order of work; a box is ticked only with the evidence beside it.

- [ ] Token amounts in their own units (`ft_metadata`: symbol and decimals), so a coverage in test USDC reads "10 tUSDC", not "10000000 (smallest unit of ...)". Coverage, Claims and report pages. Built with tests (`data/token-amount.ts`, `useTokenMeta.ts`); not yet seen on a screen
- [ ] `ui/ExposureBefore.tsx` (R26): the owner enters an agent, target, token and block and sees the vault's `exposure_before`, checked against the vault's own view. Built with tests (`data/exposure-before.ts`, on the Claims page); not yet seen on a screen
- [x] `docs/CONSOLE-TESTING.md` section 5d: scenarios C1 to C14 for Coverage, Buy, Claims, the report page and the exposure panel, with the URL, the button and the expected output of each (C1 to C3, C10, C11 seen on a screen; the rest wait for a person at the browser or for an attestor)
- [ ] Screen evidence still missing, needs a person at the browser: the Playground Stop button, the "previous run was interrupted" notice, loosen back, the key export download. Record the result and hashes in `docs/CONSOLE-TESTING.md`
- [ ] Check the published site (`https://www.arunafi.xyz/`) with a wallet: Lookup, Dashboard, Playground, Create, Coverage, Claims
- [ ] Record the F1 run for the video (script in `docs/SUBMISSION.md`)

- [ ] L10 (U19): in the agent wizard, "I already have the key" takes a pasted public key (checked before signing), skips the browser key, and shows the MCP server command with the vault and key file. Built with tests (`data/agent-key-input.ts`, `data/agent-connect.ts`); not yet seen on a screen, scenarios A1 to A4 in `docs/CONSOLE-TESTING.md`. The `examples/` scripts are fixed to the demo2 vault, so they are not offered

Not started on purpose: USDC purchases (cannot be proven until an attestor heartbeat is fresh). The mock stores that remain (`vault-mock`, `coverage-mock`, `claims-mock`, `mock`) feed only the Guided demo, which is a scripted walkthrough and stays on sample data.

## After v0

Order by value to a judge or first customer: L7, then L9, L8, L10, then L11 and L12 when Aris lands U15 and U17.

**L7 status (13 November 2026).** About half done, not closed. In: the report page `/console/claims/detail/?id=<n>` read from the registry (timeline from the registry's own state, the full record, a `get_report` command; sending a conflicting report and the arbiter's ruling stay with the attestor and arbiter accounts, not the console), the coverage list read from the pool (`/console/coverage/`), the Buy page (price from the pool's own `quote`, the assigned attestor and its heartbeat, preview and wallet signing for NEAR; the Buy button stays off while the heartbeat is stale), and the Claims page (drift reports from the registry, the pool's claim outcomes, the payout formula with its terms as the contract counts them, and Start a claim). Seen on screen for vault `demo4.factory2.arunafi.testnet` and for `l2ocbae`. Not done: a real purchase and a real claim from the console (the assigned attestor's heartbeat is stale, see `docs/FOR-ARIS.md` item 1), USDC purchases, `ui/ExposureBefore.tsx` (R26), deleting the two mock stores (Attestor, Pool, TargetDetail and ReportDetail still read them), the named screen tests. README step 5h (Coverage and claims, with commands that check the pool, the registry and the vault) was added on 13 November; its purchase and claim from the console are stated as not met. Two possible problems in the pool's claim code were found by reading and are with Aris (`docs/FOR-ARIS.md` item 7).

- **L7 Coverage and claims, live (U11).** Delete `coverage-mock.ts`, `claims-mock.ts` and their tests. Purchases and claims through `OwnerCoverage` over the L1 transport; USDC as the owner's `ft_transfer_call` (KTD15), option disabled with a reason and a README link when the balance is short. Paid claim shows `min(exposure before the claimed block x ratio, remaining limit)` with each term (R29). Attestor and arbiter statement and heartbeat state on the purchase screen (R30). `ui/ExposureBefore.tsx` for R26. Covers AE7.
- **L8 Pool and underwriter, live (U12).** Per-token book: capital deployed and locked, concentration per code hash and per upgrade authority against its limit, claims pending, disputed, paid, attestor alive (R31). Deposit and withdraw capital (R32).
- **L9 Targets and attestor, live (U13).** Live class and evidence from `@aruna/classifier-core`, registry class, class-change history, drift reports, frozen state; `local_upgradeable` always shows its basis and `unknown` stays unknown (R33). Attestor view read-only: heartbeats, assigned targets, reports (R34). Needs indexer routes for reports and heartbeats, which do not exist yet: ask Aris.
- **L10 Agents from the CLI or MCP (U19).** Paste a public key, then show the commands for `examples/` or the MCP server (R19).
- **L11 Migration in the console (U16).** After Aris's `migrate` orchestrator. Coverage warning first (R39), each transaction previewed (R13), old vault shows no active agents and explains its balance (R37), version flag with a link to migrate (R40). Covers AE8 and AE9.
- **L12 Simulation on published output (U18).** Read `packages/sim/results/<date>/`, delete the in-browser model `data/simulation.ts`, list every assumption and name `P(event)` an underwriting assumption (R42, R43).
- **L13 Docs (U20, with Aris).** README steps for every phase 2 claim (R45).

---

## Open questions for Aris

1. Who hosts the indexer container and holds the FastNear key, and by when? (blocks L5 live history and L6)
2. ~~Will the API gain routes for coverages, claims, drift reports, freezes, heartbeats and class changes (R7)?~~ **Yes, built 12 November 2026:** `/v1/coverages`, `/v1/claims`, `/v1/reports`, `/v1/freezes`, `/v1/heartbeats`, `/v1/attestors`, `/v1/classes`, typed in `packages/indexer/src/api.ts` and read by `createIndexerClient`. They are in a separate `CoverageDriftClient` interface, so `data/indexer-fixture.ts` (yours) compiles unchanged; add the new methods to it when L7 and L9 start. Needed by L7 and L9, not by v0. The hosted indexer serves them after its next deploy (it migrates its store on start, see the indexer README).
3. Does the indexer URL for the default build exist yet, and what is it?
4. Is the plan's judging end date (R48) known?

## Risks

- **Wallet deposit** (L0): not proven for every wallet; test with one and document which.
- **Time:** L1 to L5 in about two days is tight. The fixture lets L5's UI move in parallel. The cut rule above is the fallback.
- **Browser agent keys** live in `localStorage` and are lost when site data is cleared (R23). They are testnet keys limited to one vault, labelled as such.
- **SDK in the browser:** `@aruna/sdk/vault` uses `near-api-js`; L0 checks it bundles.
