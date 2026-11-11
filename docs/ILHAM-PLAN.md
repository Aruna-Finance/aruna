# Ilham's plan: lane B (console, live)

This is Ilham's scope in `docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md`. It is lane B: the console stops using mock data, signs through the connected wallet, and reads history from Aris's indexer. Aris owns lane A (indexer, contracts, CLI, `@aruna/sim`) and has agreed that Ilham may touch the small SDK and `examples/` changes listed under L4 and L5.

The plan file is the authority for requirements (R-numbers), decisions (KTD-numbers) and acceptance examples (AE-numbers). This file only orders the work and says when each phase is done.

**Cut:** 13 November 2026, 23:59 UTC+7. Whatever state F1 is in then, the remaining time goes to the submission checklist (L6). Deadline: 14 November 2026, 23:59 UTC.

**Rules that bind every phase:** testnet only and no signing on mainnet (R12); the console never reimplements a classification check (CLAUDE.md rule 10); a policy refusal is shown as an outcome with its reason code, an authorization failure as a failure (R14); no agent key and no console path gives a free-form call (rule 5); never write "trustless"; no keys or `.env` in the repo; no em dash in copy.

**Working method:** one branch and one PR per phase, branch named `ilham/<phase>`. Each phase ends with typecheck, tests and `pnpm build` green, the README step for it written as "do X, see Y", and a line in the change log of `docs/UI-PLAN.md`. A mock adapter is deleted in the phase that makes its screen live (KTD12).

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
| L8 | U12 | Pool and underwriter, live | L5 | after v0 |
| L9 | U13 | Targets and attestor, live | L5 | after v0 |
| L10 | U19 | Agents brought from the CLI or MCP | L3 | after v0 |
| L11 | U16 | Migration in the console | Aris U15 | after v0 |
| L12 | U18 | Simulation on published output | Aris U17 | after v0 |
| L13 | U20 | Phase 2 docs and README steps | L7 to L12 | after v0 |

L1 to L4 are a chain. The UI parts of L5 (activity list, exposure history, the draft policy panel) can be built against `apps/web/src/console/data/indexer-fixture.ts` while L3 and L4 wait on a wallet, so start them in the gaps.

---

## v0

### L0. Prove the wallet and the SDK in a browser

Why first: L1 to L5 assume things the docs do not prove. If either fails, the plan changes, so find out before building screens.

- [ ] Read `packages/sdk/src/vault/near-transport.ts` and `transport.ts` (`CallResult`, `ArunaAuthError`, `ArunaRpcError`) so the wallet transport maps outcomes the same way
- [ ] Add a throwaway page (not committed) that imports `@aruna/sdk/vault` and `near-api-js`, and confirm `pnpm build` of `apps/web` succeeds and the bundle loads in the browser
- [ ] Ilham sends one real 1 yoctoNEAR call from a testnet wallet through `signAndSendTransaction` (for example `set_ceiling` with the current ceiling on a test vault). `pause_agent` attaches no deposit and proves nothing here
- [ ] Record the transaction link, the wallet used, and whether the deposit was attached
- [ ] Agree with Aris who hosts the indexer and holds the FastNear key (never in the repo), and write the answer in the change log

Done when: one explorer link shows the 1 yocto deposit, and the SDK vault entry builds in `apps/web`. If the deposit is not attached by the wallet, stop and report (plan stop condition).

### L1. Wallet transport, transaction preview, history client (U4)

Requirements: R9 to R14. Files under `apps/web/src/console/`.

- [ ] `wallet-transport.ts`: `VaultTransport` over `@hot-labs/near-connect`: `call` as one function-call action, `view` and `account` over `@aruna/rpc`, outcome mapped to `CallResult` with receipts keyed by executor, `Failure` to `ArunaAuthError`, a rejected wallet promise to a cancel, mainnet throws before any prompt
- [ ] `WalletContext.tsx`: expose the connector for signing
- [ ] `ui/TxDialog.tsx`: show method, receiver, deposit, gas before the wallet opens; pending, confirmed (explorer link) and failed after signing; keep the cancel case
- [ ] `history.ts`: the `@aruna/indexer/client` plus three states: live, behind (poll until the tab's own transaction is indexed, keep it as a pending row), unavailable since block N
- [ ] `ui/Freshness.tsx`: show the state and the last indexed block
- [ ] Add `@aruna/indexer` client to `apps/web` and widen the boundary test only as far as needed (client entry, never server code)
- [ ] Tests: two-receipt outcome mapping; failure vs cancel; mainnet refusal; `withdraw_to_owner` preview shows 1 yocto and the vault as receiver; network error gives "unavailable" with the last known block (AE2); refusal rendered as outcome not toast; behind state keeps the pending row

Done when: a connected testnet wallet pauses an agent on a test vault from the console and the transaction is on the explorer.

### L2. Create your own vault (U5)

Requirements: R11, R15 to R17; AE4.

- [ ] `data/factory.ts`: read the factory's minimum deposit, build `create_vault` (`name`, `owner`, `operator`, `ceiling`), check a duplicate name before signing
- [ ] `screens/CreateVault.tsx`: total needed = minimum deposit + vault deposit + gas, balance check; if short, show the shortfall and a faucet link and send nothing
- [ ] Ceiling picker lists only targets with a registry class, each with its class and evidence one click away; default ceiling contains `swap.arunafi.testnet`
- [ ] Deposit NEAR into the vault as a previewed plain transfer
- [ ] Setup checklist derived from chain state (created, ceiling set, funded, first agent added), resuming at the first step not done
- [ ] `useVault.ts`: live `readVault`; `walletRole.ts`: role from the vault's on-chain owner and operator; the wallet's vault list from the indexer (`vaults?owner=` and `?operator=`)
- [ ] `nav.ts`: an entry when the wallet has no vault
- [ ] Keep `data/vault-mock.ts` until no importer remains; move `vaultStore` into a story-local fixture because the guided demo keeps its content
- [ ] Tests: short balance builds no transaction (AE4); existing name caught; picker omits unclassified targets; created-but-unfunded vault opens at "fund the vault"; indexer down after creation still opens the vault with "history unavailable"; role is owner and operator when both are the wallet, neither for a stranger

Done when: a fresh testnet wallet creates a vault, sets a ceiling containing `swap.arunafi.testnet`, deposits NEAR and sees the balance.

### L3. Agents and role actions (U6)

Requirements: R18, R20, R21, R23; AE1, AE5.

- [ ] `agent-keys.ts`: generate an ed25519 keypair in the tab, store under network + vault + public key in `localStorage` (try/catch every access), label "testnet agent key, limited to this vault", export as a download
- [ ] `AgentWizard.tsx`: register the public key through `OperatorVault.createAgent`; default policy that makes the shared injected attempts return their recorded reason codes; refuse a policy outside the ceiling before signing, naming the field
- [ ] `AgentDetail.tsx`, `AgentsList.tsx`, `useActions.tsx`: pause, revoke, tighten for the operator; resume, loosen, set or remove the operator, change the ceiling, withdraw for the owner (`OwnerVault`); a disabled action carries its reason
- [ ] When one wallet is both owner and operator, `RoleContext` lets the visitor view as the operator and see "resume" disabled with "only the owner can resume an auto-disabled agent"
- [ ] An agent whose key is not in this browser is marked "key not in this browser" (revoke stays available)
- [ ] Remove the agent part of `data/mock.ts`
- [ ] Tests: key stored per vault and network, not leaked across networks; AE1 operator vs owner resume; operator cannot loosen, withdraw or change the owner; AE5

Done when: on a self-serve vault an agent is added with a browser key, paused, resumed by the owner and revoked, and each change shows on chain.

### L4. Playground, live (U7)

Requirement: R22; KTD8. Touches `examples/`, so Aris has confirmed it.

- [ ] `examples/scenarios.ts`: the injected attempts and the honest swap, defined once; `examples/injected-agent.ts` and `honest-agent.ts` import it; export from `examples/package.json`; the recorded run in `examples/README.md` must still reproduce
- [ ] `screens/Playground.tsx`: build `AgentVault` with `nearApiTransport`, vault as signer and the stored key; run attempts one at a time with queued, sending, outcome; stop at `agent_auto_disabled` and show the new state from `readVault`; Stop button halts before the next attempt
- [ ] Pre-run checks with reasons and fix links: agent active, key in this browser, swap target in the ceiling, enough vault balance
- [ ] After a reload mid-run: "previous run interrupted" with the on-chain status
- [ ] Tests: attempt order equals the recorded run; AE1 with stubbed recorded refusals ends "paused, auto-disabled"; an auth error (such as an exhausted allowance) is a failure and stops the run; no agent offered without its key; missing swap target blocks the run; Stop sends no further attempt

Done when: on a self-serve vault the injected scenario ends with the agent `Paused` and `auto_disabled: true` on chain, and `examples/injected-agent.ts` still reproduces its recorded run.

### L5. Activity, exposure and policy-to-price (U8)

Requirements: R24, R25, R27; AE2, AE3. R26 moves to L7.

- [ ] `ui/ActivityList.tsx`, `ui/ExposureHistory.tsx`: rows from the history client; a refusal shows reason code, class at refusal and its transaction link; an exposure row shows the class recorded with it; says exposure is what was sent, not the value of a position
- [ ] `Overview.tsx`, `AgentDetail.tsx` activity tab; totals from `readVault` still render when history is unavailable (AE2)
- [ ] `packages/sdk/src/coverage/quote.ts`: optional proposed policy (daily cap, riskiest class) passed to the pool's own `quote` view, so no pricing arithmetic moves into the SDK or the browser; a proposed class is a filter over registry classes. Touches the SDK, so Aris has confirmed it
- [ ] `ui/PolicyFields.tsx`, `pricing.ts`: edit a draft, show on-chain and draft quotes side by side with the draft labelled "proposed, not yet signed", debounced; declared defaults shown as assumptions; default limit set above `daily cap x days x ratio` so the premium follows the cap; "testnet, assumed numbers" on every quote (R27); "Apply" sends the tighten call through the preview
- [ ] `pricing.ts` stops computing premiums itself
- [ ] Tests: `packages/sdk/test/coverage-quote.test.ts` (proposed cap passed to `quote`, equals the pool's result); AE3 cap 2 to 1 NEAR lowers the draft premium before signing and the on-chain quote then matches; payout bound by the cap at both caps; a quote refused by the pool (zero cap) is an outcome with its reason; AE2 with history unavailable

Done when: after an L4 run the vault's activity lists each refusal within one minute, and the draft premium moves when the cap changes.

### L6. Deploy, README F1, live run, submission (U9, U10, with Aris)

- [ ] Build `apps/web` with the hosted indexer URL (build-time environment variable, KTD13) and publish `apps/web/out` to Vercel as a static site. The indexer is a separate container host, not Vercel
- [ ] Run F1 once with a fresh testnet wallet and record every transaction link in `examples/README.md`
- [ ] README: F1 steps as numbered "do X, see Y" with expected results; indexer steps including `rebuild` and its duration (hours); the hosted URLs; update the existing step 5b and 5c wording where mock data is gone
- [ ] `docs/FRONTEND.md`: browser agent keys under R18 (R44). `docs/BUILD-PLAN.md`: stages 5, 6, 8 planned together, v0 status
- [ ] After the cut: submission checklist in `docs/SUBMISSION.md`: `pnpm secret-scan` and a key check over history, public repo, demo video from the F1 run, X post, mainnet payout account, tracks `security`, `agents`, `defi`, `open`, submit before 14 Nov 23:59 UTC
- [ ] If any F1 step is not met, the README and the submission say exactly which one. Do not fake the run

Done when: a Claude Code or Codex run following the README on a clean clone gets every expected result, or the missing step is stated.

**Cut rule (13 Nov 23:59 UTC+7):** stop building; L6 runs from then. If the hosted indexer is not live by 13 Nov midday, record the run against the site as it stands and report the history step as not met.

---

## After v0

Order by value to a judge or first customer: L7, then L9, L8, L10, then L11 and L12 when Aris lands U15 and U17.

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
2. Will the API gain routes for coverages, claims, drift reports, freezes, heartbeats and class changes (R7)? The shipped routes are `vaults`, `activity`, `exposure`, `events`. Needed by L7 and L9, not by v0.
3. Does the indexer URL for the default build exist yet, and what is it?
4. Is the plan's judging end date (R48) known?

## Risks

- **Wallet deposit** (L0): not proven for every wallet; test with one and document which.
- **Time:** L1 to L5 in about two days is tight. The fixture lets L5's UI move in parallel. The cut rule above is the fallback.
- **Browser agent keys** live in `localStorage` and are lost when site data is cleared (R23). They are testnet keys limited to one vault, labelled as such.
- **SDK in the browser:** `@aruna/sdk/vault` uses `near-api-js`; L0 checks it bundles.
