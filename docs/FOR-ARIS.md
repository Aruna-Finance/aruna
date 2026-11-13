# For Aris: what Ilham cannot do from the console lane

Written 13 November 2026 by Ilham's side (lane B, console). Each item says what was seen, what is needed, who can do it, and what it unblocks. Nothing here changes a contract. Cut is 13 November 23:59 UTC+7; deadline 14 November 23:59 UTC.

## 1. Attestor heartbeat is stale (blocks buying coverage)

- Seen: `node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"drift-target.arunafi.testnet"}'` returns `false`. Its assigned attestor is `attestor-a.arunafi.testnet`.
- Seen: `swap.arunafi.testnet` has no assigned attestor (`assigned_attestor` returns `null`) and `heartbeat_fresh` is `false`.
- Effect: the console Buy page (`/console/coverage/buy/`) shows "has not sent a fresh heartbeat" and keeps the Buy button disabled. That is the intended R30 behaviour, but it means a coverage purchase cannot be proven from the console.
- Needed: run the attestor daemon (`@aruna/attestor`) for `attestor-a.arunafi.testnet` so `heartbeat_fresh` is `true`. If the demo target should be `swap.arunafi.testnet`, assign an attestor to it too.
- Unblocks: L7 acceptance "the owner buys NEAR coverage from the console and sees it in the list" and the claim screen on a live coverage.
- Done when: the command above prints `true`, then Ilham buys once from the console and the new coverage appears in the list.

## 2. Hosted indexer is behind and its head looks stale

- Seen at 13 November, `https://aruna-near-indexer.up.railway.app/health`: `last_indexed_block` 277205229, `head_block` 277457885, `lag_blocks` 252656, `healthy` false, `mode` catching_up, `head_seen_ms_ago` about 7,000,000 (nearly two hours). `last_indexed_block` moved from 277196125 earlier in the day, so it advances, but slowly; `head_block` did not move at all, which suggests the head poll is stuck.
- Effect: every History panel in the console says "not connected". README step 5g stays "not met". The site `https://www.arunafi.xyz/` is built without `NEXT_PUBLIC_INDEXER_URL`.
- Needed: (a) a healthy indexer (caught up, or at least serving the vaults used in the demo); (b) tell Ilham the final URL; (c) the QuickNode key that was pasted into a chat on 12 November should be rotated, since it was shown in plain text.
- Then Ilham: sets `NEXT_PUBLIC_INDEXER_URL` in Vercel, redeploys, and updates README step 5g.
- Done when: `/health` shows `healthy` true and the Activity tab of `https://www.arunafi.xyz/console/dashboard/?vault=l2ocbae.factory2.arunafi.testnet` lists the refusals with their reasons.

## 3. `examples/` is yours; the Playground mirrors it

- The console Playground runs two scenarios (honest and injected) from `apps/web/src/console/data/playground-scenarios.ts`. A test pins their order to the recorded run in `examples/README.md`.
- Not done: `examples/scenarios.ts`, `examples/honest-agent.ts` and `examples/injected-agent.ts` were not touched, so the console and the scripts keep two copies of the attempt list.
- Needed: either you move the list into a shared `examples/scenarios.ts` that the console imports, or you say it can stay as two copies guarded by the test. Ilham will not edit `examples/` without your word.
- Not blocking v0.

## 4. Heads-up: `packages/sdk/src/coverage/quote.ts` was edited by Ilham

- Merged in PR #33. `QuoteRequest` gained an optional `proposed: { dailyCap?, maxRiskClass? }`, a refusal reason `class_above_proposed`, and `dailyCapSource` reads "proposed, not yet signed: ...". Four tests were added to `packages/sdk/test/coverage-quote.test.ts` (13 in all).
- Behaviour without `proposed` is unchanged. The price is still the pool's own `quote` view; the SDK holds no pricing arithmetic.
- Needed: a look at it, since the plan assigned that file to the lane that owns the SDK. If you want it changed, say how.

## 5. Not built on the console side, may need you later

- USDC (test token) purchases in the Buy page: only NEAR is offered. Needs a decision on which test USDC contract the console should use (`usdc.arunafi.testnet` appears in the existing coverages).
- Token amounts are shown in the smallest unit with the token named, because the console does not read token decimals.
- Claims screen: it will read `/v1/claims` and `/v1/reports` from the indexer once that is healthy (item 2).

## 6. Windows-only test failures (low priority)

- `sdk` `abi-drift` fails on a CRLF checkout (passes with LF). `indexer` `cli.test.ts` "read-only directory" fails on Windows because the permission is ignored. Documented in README step 1. Fix only if you want a clean `pnpm -r test` on Windows.

## Order that helps most before the deadline

1. Item 1 (attestor heartbeat): about the smallest action, and it unblocks the one coverage claim that is still unproven.
2. Item 7 (two points in the pool's claim code): a yes or no with a test, before tonight; it decides what the README may say about claims.
3. Item 2 (indexer URL): unblocks the History panels and README step 5g.
4. Items 4 and 3: a short reply is enough.

## 7. Two things found by reading the pool's claim code (not reproduced, no Rust toolchain on Ilham's machine)

Owner: you (lane A). The pool contract is yours; Ilham will not change it, and the plan says to stop and tell you if the core flow needs a contract change. Ilham cannot reproduce these: there is no Rust toolchain on that machine, so no `cargo test`.

What is asked: confirm or refute each point with a test, and answer before tonight (13 November) so the README and the submission can say the right thing. A redeploy of the pool before the 14 November 23:59 UTC deadline is your call. If you confirm a point and cannot fix it in time, say so and Ilham will list it as a known limitation in the README and `docs/SUBMISSION.md` instead of claiming the claim path is safe.

Who is affected if confirmed: the first point only coverage that has already been released (ended and past the 600 block reporting period); the second only token (FT) coverage. The NEAR path for coverage that is still active is not touched by either.

Both are in `contracts/pool/src/lib.rs`. Neither was run; they come from reading `claim`, `cb_claim_report`, `cb_claim_pay`, `release_expired` and `pay`. Please confirm or refute with a test.

- **A claim can still pay after `release_expired` released the coverage.** `claim` and `cb_claim_report` never check `c.released`. `release_expired` already removed the coverage's remaining limit from `total_limits`, `by_hash` and `by_authority`; `cb_claim_pay` then subtracts the payout from them again with `saturating_sub`. The book's `total_limits` and the concentration totals can end up lower than the limits really outstanding, which weakens the capital adequacy check on later purchases. Reachable when a report verifies late and someone claims after `end_block + CLAIM_REPORTING_BLOCKS` (600). `pool/src/tests.rs` has no test for a claim on a released coverage (the only `released` assertion is at line 324).
- **The payout transfer is fire and forget.** `pay` (line 215) detaches the `Promise` and nothing checks it. `cb_claim_pay` has already reduced `capital`, raised `paid_out`, advanced `paid_through_block` and recorded `outcome: "paid"`. If an `ft_transfer` fails (for example the owner is not registered on the token), the claim shows as paid, the money stays in the pool's token balance but is no longer in the book, and `ARUNA_ALREADY_PAID` blocks a retry. A NEAR transfer to a deleted account has the same shape. Only matters for token coverage; the NEAR path to an existing owner is fine.

Not problems, for the record: a claim is re-validated at claim time, refusals return and are recorded as `claim_rejected`, `claim_in_flight` has a timeout, minimum gas is required, exposure counts only between `paid_through_block` and the change so one change cannot pay twice, and the payout always goes to the coverage's owner.
