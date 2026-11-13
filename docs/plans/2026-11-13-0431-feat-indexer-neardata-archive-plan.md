---
title: Indexer backfill from neardata with a FastNear key - Plan
type: feat
date: 2026-11-13
topic: indexer-neardata-archive
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Indexer backfill from neardata with a FastNear key - Plan

## Goal Capsule

- **Objective:** The indexer's backfill of the v2 history below dRPC's window completes without QuickNode credits, so the console has the full v2 history by the release and a lost or exhausted QuickNode trial no longer stalls it.
- **Means:** neardata (`testnet.neardata.xyz`), read with a FastNear key, becomes the archive for heights below dRPC's lower edge (KTD1).
- **Product authority:** `packages/indexer` block sources, its CLI, its tests and its deploy docs. The database, the read API, the start block and the routing for heights inside dRPC's window are not active scope.
- **Stop conditions:** Stop and report if neardata blocks decode to records different from the RPC sources' for the recorded window. A 401 or 403 on the U3 live check stops only that measurement and is reported; the code still ships, with the runtime behavior R5 defines.
- **Execution profile:** testnet only, read-only; the FastNear key is a secret that never reaches a log, an error, `/health` or the repo.
- **Who ships:** the implementer opens a PR to `main`; the user sets `FASTNEAR_API_KEY` on Railway (a rotated key: the previous one was pasted into a chat).
- **Open blockers:** none for planning. Whether the user's key works on testnet neardata, and how fast, is measured during U3 (R7).

---

## Product Contract

**Superseded in part (13 November 2026, user-directed):** QuickNode is the archive and neardata its backup, not the other way round, while the user waits on review of the FastNear key. Where this plan says neardata is the archive and QuickNode its backup (R4, R5, KTD1, the Key Decision on both keys set), read the roles swapped: with both set, QuickNode reads below dRPC's edge and neardata reads what QuickNode fails to serve; with only a key, neardata is the archive; without a key nothing changes. The router fix (KTD3) is unchanged.

### Summary

With `FASTNEAR_API_KEY` set, the indexer reads every height below dRPC's lower edge from neardata, then switches to dRPC for the rest and the head, as it does with QuickNode today. Without the key nothing changes.

### Problem Frame

The indexer starts at block 277103284 and dRPC keeps only about two days of blocks, so about 110,000 heights must come from an archive. Today that archive is a QuickNode trial: about 6M credits for this gap, rising about 180,000 credits an hour while the gap grows, rate-limited to 3 blocks in flight, and gone when the trial ends. The alternative, NEAR's archival RPC, reads about 19 blocks a minute and never catches up. neardata keeps every block, and the user now holds a FastNear key; the source was removed in PR #42 only because the earlier keys were invalid.

### Key Decisions

- **neardata is the archive below dRPC's edge, not a source for the whole range.** The head and recent blocks stay on dRPC, which is proven on this deploy; only the part dRPC cannot serve moves. (session-settled: user-approved — chosen over neardata for every height and over keeping QuickNode as the only archive: the user confirmed this scope.) Governs R1, R3.
- **neardata is used only with a key.** Keyless it serves about 30 blocks a minute, slower than the chain. Governs R2.
- **With both a FastNear key and a QuickNode URL set, neardata is the archive and QuickNode is its backup.** QuickNode is called only for heights neardata fails to serve, so credits are spent only while neardata is down and the backfill never drops to NEAR archival's 19 blocks a minute while QuickNode works. (session-settled: user-directed — chosen over sending neardata's failures straight to NEAR archival: a stalled backfill near the release costs more than credits.) Governs R4, R5.

### Requirements

**Source**

- R1. With `FASTNEAR_API_KEY` set, every height below dRPC's earliest block plus 2,000 is read from neardata, and once a height above that is read, neardata is never called again.
- R2. Without `FASTNEAR_API_KEY`, the indexer behaves as it does today.
- R3. Records built from neardata blocks equal those built from the RPC sources for the same heights.
- R4. With both `FASTNEAR_API_KEY` and `QUICKNODE_RPC_URL` set, neardata reads the heights below the edge and QuickNode reads only those neardata fails to serve; the start log names both.

**Failure and secrecy**

- R5. When neardata rejects the key or fails, the read falls back to QuickNode when its URL is set, else to NEAR's archival RPC; the log names neardata as the failing endpoint, and `/health` `source` names the endpoint that served the block until neardata recovers.
- R6. The FastNear key never appears in a log line, an error message, `/health` or the repo.

**Docs**

- R7. The deploy doc and `.env.example` list `FASTNEAR_API_KEY` as the optional archive, with a command that checks the key against testnet neardata and measures its speed without printing the key.

### Scope Boundaries

- No change to the database, the read API, the start block or the head routing.
- `ARUNA_BLOCK_SOURCE` is not brought back; the key alone selects neardata.
- Considered and not built: a startup probe that refuses to start with a rejected key. The existing bench-and-fallback (R5) already keeps ingest correct and says which endpoint failed; a refusal would turn a bad key into a down service.

### Sources / Research

- `git show 0c499ed~1:packages/indexer/src/ingest/neardata.ts` and `.../test/neardata.test.ts`: the source and its tests as they were before PR #42 (Bearer header, retries, permanent 4xx, a retried truncated body).
- `packages/indexer/src/ingest/routed.ts`: the `archive` lane, the edge latch and `withFailover`'s 5-minute bench.
- `packages/indexer/src/cli.ts` `chooseSource`: where the archive lane is built today (QuickNode only).
- `packages/indexer/test/rpc.test.ts`: the recorded window replayed through the RPC source must give the same records as the recorded neardata blocks (`test/fixtures/blocks`).
- 13 November 2026: `https://testnet.neardata.xyz/v0/block/277103284` answered 200 without a key in 0.8 s, so the archive holds the start block.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **neardata goes in the existing `archive` lane of `routedSource`, and the router gains an optional backup for that lane.** The archive lane already reads only below dRPC's edge, latches off after it, and benches a failing endpoint. A failed or benched archive read now goes to the archive's backup (QuickNode, when set) before the general fallback (NEAR archival). The backup obeys the same edge latch: it is never called at or above the edge. Implements R1, R4, R5.
- KTD2. **The neardata lane reads 8 blocks at a time.** That is the window size, so the archive is never the bottleneck of a window; the old neardata default of 16 was for a whole-range source. The rate with the user's key is measured in U3 and recorded in the deploy doc. Implements R1.
- KTD3. **The router never hands one lane's scan to another lane's `expand`.** The lanes' scan types differ (a neardata block versus an RPC scan), and today `routedSource.expand` sends a scan to the fallback's `expand` when the scanning lane is benched or its `expand` fails: with neardata as the archive, a window whose neardata reads succeed and then one fails would pass neardata blocks to the RPC source and abort the run with a TypeError. So a routed scan carries its height, and when the scanning lane is benched or fails, the router reads that height again from the fallback (`block`, then `expand`). The router is built over `unknown`, which the typecheck cannot guard, so a test does (U2). Implements R3, R5.
- KTD4. **The key travels only in the `Authorization: Bearer` header and is redacted from every error neardata's source raises,** mirroring `redact` in `src/ingest/rpc.ts`. Implements R6.

### Sequencing

U1 restores the source; U2 wires it into `chooseSource`; U3 updates the docs and records the measured rate. Each leaves `pnpm --filter @aruna/indexer test` and `typecheck` green.

---

## Implementation Units

### U1. The neardata source, back

**Goal:** `neardataSource` reads testnet neardata with an optional key, as before PR #42, and never leaks the key.

**Requirements:** R3, R6; KTD4.

**Dependencies:** none.

**Files:**
- `packages/indexer/src/ingest/neardata.ts` (restore from `0c499ed~1`, importing the block types from `src/ingest/blocks.ts`)
- `packages/indexer/test/neardata.test.ts` (restore, plus the retried truncated body from the old `review-fixes.test.ts` #10)

**Approach:** restore the file and its tests as they were, change the type import, and add key redaction to every error message it raises.

**Patterns to follow:** `redact` in `packages/indexer/src/ingest/rpc.ts`.

**Test scenarios:**
- The key is sent as `Authorization: Bearer <key>`; without a key no Authorization header is sent.
- A 429 is retried and the block is returned.
- A 403 is not retried and fails at once.
- A response whose body cannot be read is retried.
- An error message for a failed read contains neither the key nor the header.

**Verification:** the restored tests pass, and no message the source raises contains the key.

### U2. neardata as the archive lane

**Goal:** `chooseSource` builds the neardata archive lane when `FASTNEAR_API_KEY` is set, ahead of QuickNode.

**Requirements:** R1, R2, R3, R4, R5; KTD1, KTD2, KTD3.

**Dependencies:** U1.

**Files:**
- `packages/indexer/src/cli.ts` (`chooseSource`, the usage text)
- `packages/indexer/test/cli.test.ts`
- `packages/indexer/src/ingest/routed.ts` (KTD3: re-read a height from the fallback instead of forwarding a foreign scan)
- `packages/indexer/test/routed.test.ts`

**Approach:**
1. Archive lane: neardata labelled `neardata` when the key is set, with QuickNode as its backup when its URL is set; QuickNode alone as the archive when only its URL is set; else none.
2. The start label names the archive and its backup.
3. In `routed.ts`, the archive's failover goes to its backup when present and not benched, then to the fallback (KTD1, KTD3).
4. Build the router over `unknown` (KTD3).

**Test scenarios:**
- With `FASTNEAR_API_KEY`, the label names neardata to dRPC's edge, and the label carries no key.
- With `FASTNEAR_API_KEY` and `QUICKNODE_RPC_URL`, the label names neardata with QuickNode as its backup.
- With neardata failing and a backup set, heights below the edge are read from the backup, never from NEAR archival while the backup works, and the backup is never called at or above the edge.
- With neither, the label is today's.
- A router whose archive is a neardata-shaped source and whose live lane is an RPC source commits the recorded window to the same export as the baseline `test/fixtures/baseline/recorded-window.json`, with heights below the edge read from the archive.
- With the archive failing every read, heights below the edge are read from the fallback and `state().source` is `NEAR archival`.
- In one window the neardata-shaped archive serves some heights and then fails one, which benches it: every height of the window still commits, no scan reaches a lane that did not read it, and the export equals the baseline.

**Verification:** the indexer suite passes, and the recorded window exports the baseline bytes through a neardata archive.

### U3. Docs and the measured rate

**Goal:** a stranger can set and check the key, and the deploy doc states the rate it reaches.

**Requirements:** R7; KTD2.

**Dependencies:** U2.

**Files:** `docs/DEPLOY-INDEXER-RAILWAY.md`, `packages/indexer/.env.example`, `.env.example`, `packages/indexer/README.md`.

**Approach:**
1. `FASTNEAR_API_KEY` in the variables tables and `.env.example` files, as the optional archive that takes precedence over QuickNode.
2. A key check: one `curl` against `testnet.neardata.xyz/v0/block/277103284` with the key from a shell variable, printing only the status and time; and a 20-block timing loop.
3. Run that check against live testnet neardata with the user's key from their environment, never pasted into a file or chat. If it is not available, write the doc without a measured rate and say so.
4. The credit check section says it applies only when QuickNode is the archive.

**Execution note:** documentation plus one live, read-only measurement.

**Test scenarios:**
- Test expectation: none -- documentation; the measured rate is recorded, not asserted.

**Verification:** the deploy doc names `FASTNEAR_API_KEY`, the check commands run as written, and no key appears in the diff.

---

## Verification Contract

| Gate | Command or check | Proves |
|---|---|---|
| Indexer tests | `pnpm --filter @aruna/indexer test` | R1-R6 |
| Typecheck | `pnpm --filter @aruna/indexer typecheck` | KTD3 compiles |
| Secret scan | `pnpm secret-scan` | R6 |
| Live key check (user's key, read-only) | the U3 commands | the key works on testnet neardata, and its rate |

## Definition of Done

- Every unit's scenarios exist and pass, and every gate above is green.
- The recorded window exports the baseline bytes through a neardata archive.
- No key in the diff, a fixture or a test log.
- Code from abandoned attempts is removed.
- The PR body says to set a rotated key on Railway and what the logs and `/health` show when neardata is the archive.
