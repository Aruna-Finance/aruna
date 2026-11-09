# UI work log and phase plan

Scope: the frontend only (`apps/check`, `apps/console`, the public agent page, the underwriter view).
Source of truth for requirements is `FRONTEND.md`; this file tracks **what was done, in which phase,
on which branch**. If they conflict, `FRONTEND.md` wins.

## Rules for every phase

- One branch per phase, named `ui/f<N>-<slug>`. Branch off the previous phase when it is green, not off `main`.
- Never reimplement a classification check. Consume `@aruna/classifier-core` (CLAUDE.md rule 10).
- `apps/check` stays static, keyless and backend-free (non-negotiable 1).
- Every phase ends with: `pnpm typecheck`, `pnpm test`, `pnpm build` green, and its checklist ticked here.
- Nothing is committed without the owner's say-so.

Non-negotiables from `FRONTEND.md`, checked at every phase review:
1 static check app · 2 policy-to-price visible · 3 public page needs no login · 4 refusals are normal
outcomes · 5 class always has evidence one click away · 6 `unknown` shown as unknown ·
7 two trust assumptions where coverage is bought · 8 stale heartbeat visible · 9 `local_upgradeable` shows its basis.

## Overview

| Phase | Branch | Goal | Depends on | Release |
|---|---|---|---|---|
| F0 | `ui/f0-scaffold` | Static-export app, types, stub adapter, verify panel | nothing | v0 |
| F1 | `ui/f1-check-live` | Live lookup from the browser via real engine | `classifier-core`, `rpc` (Stage 1) | v0 |
| F2 | `ui/f2-check-page` | Full front-door page, copy, a11y, deploy, README steps | F1 | v0 |
| F3 | `ui/f3-agent-page` | Public agent page, no login | vault, `sdk` (Stage 3–4) | v0 if time |
| F4 | `ui/f4-console` | Owner/operator console, policy-to-price, refusals, migration | `sdk`, `indexer` (Stage 5–6) | after v0 |
| F5 | `ui/f5-coverage` | Coverage purchase, underwriter view, claims, heartbeat | `pool`, `attestor` (Stage 7) | after v0 |
| F6 | `ui/f6-hardening` | E2E, performance, accessibility audit, submission polish | F2 at minimum | v0 |

Deadline for v0: **14 November 2026, 23:59 UTC**. F0–F2 are the committed UI scope. F6 runs against whatever
has shipped by then.

---

## F0 — Scaffold · branch `ui/f0-scaffold` · status: DONE (uncommitted)

Done:
- [x] Next.js 16.4.5 static export (`output: "export"`), React 19.3.1, TypeScript 5.9.3, Vitest 5.1.0, versions pinned
- [x] `src/lib/classifier-types.ts` mirrors `CLASSIFIER.md` (to be deleted when `classifier-core` exists)
- [x] `src/lib/classifier-adapter.ts` is a **stub**: four `*.example.testnet` fixtures, implements no check
- [x] Result view: class, `mutabilityBasis` text, evidence open by default, `unknown` styled as unknown
- [x] `global_by_account` side-by-side: `view_account.code_hash` (wrong) vs `view_code.hash` (true)
- [x] "Verify this yourself" panel: three `curl` commands with bodies copied from docs.near.org
- [x] 3 unit tests for the command builder, including shell-quote safety
- [x] CORS tested with `curl` + fake `Origin`: preflight and POST OK on `free.rpc.fastnear.com` and `test.rpc.fastnear.com`
- [x] `.gitignore` covers `.next/`, `out/`, `next-env.d.ts`

Known limits carried forward:
- Placeholder hashes `STUB-hash-*` are not real hashes.
- Zero hash `1111…1111` is a display constant (NEAR-FACTS §6), because the evidence type has no field for `view_account.code_hash`. Ask the engine team to expose it.
- CORS result is from `curl`, not a real browser. Re-confirm in F1.
- Rate limits of the FastNEAR endpoints are unpublished.

Environment notes: `corepack enable` fails without admin on this machine; `npm install -g pnpm@9.15.4` was used instead.

---

## F1 — Live lookup · branch `ui/f1-check-live`

Blocked until `@aruna/classifier-core` and `@aruna/rpc` exist. Until then only the non-blocked items can start.

- [ ] Replace `lookup()` body with `classify(accountId, fetchRpcReader(network))`; delete `classifier-types.ts` and the stub
- [ ] Browser-origin CORS check for all three request types, including `view_code` response size
- [ ] Fallback RPC endpoint list with retry; test the fallbacks' CORS before listing them
- [ ] `view_access_key_list` pagination (`limit`, `after_key`): accounts with more than 100 keys fail without it on nearcore 2.14.0
- [ ] Failure states as normal results: account not found, RPC down, rate-limited, unparseable WASM → `unknown`
- [ ] Input validation of account ids; mainnet is read-only, label it
- [ ] Show `checkedAtBlock` and the network with every result
- [ ] Test: a no-contract account is **not** shown as a global-contract account (both report a zero `code_hash`)
- [ ] Test: `local_upgradeable` always renders its basis; `upgrade_imports` never reads "can be upgraded"
- [ ] Confirm the engine team exposes the monitored `view_account.code_hash` in evidence

Acceptance: pasting a real testnet and a real mainnet account from a static build served by a plain static
server returns a live class with evidence; the `curl` commands in the verify panel return the same data.

## F2 — Front-door page · branch `ui/f2-check-page`

Content from the Claude web prototype, ported to `FRONTEND.md` rules. The prototype is a reference for flow only.

- [ ] Hero uses the positioning sentence from `COMPETITIVE.md`; no "budget, not your keys", no "spending firewall"
- [ ] Sections: problem (access control vs economic policy), four risk classes, the invisible-change case, two trust assumptions
- [ ] Copy audit: *verifiable* and *reproducible*, never *trustless*; comparative claims scoped to "the five projects surveyed"
- [ ] The "3 blocks" claim states it is a single-shard lower bound
- [ ] Responsive layout down to 360px; keyboard and screen-reader pass; contrast check
- [ ] Mock refusal log marked as an illustration, not live data
- [ ] Stage 2 measurement table slot (class distribution, with source, query and date) once the CLI produces it
- [ ] Deploy to a plain static host; record the URL and the build command
- [ ] README steps for this app: numbered "do X, see Y", each with an expected result

Acceptance: a stranger follows the README steps and sees the expected result; Lighthouse accessibility reviewed.

## F3 — Public agent page · branch `ui/f3-agent-page`

Needs a deployed vault and `@aruna/sdk`. One `view_access_key_list` call backs most of the page.

- [ ] Answers, in order: what the agent **cannot** do and who enforces it; who owns the funds and what the operator cannot do; limits and usage today; exposure by class; how to verify
- [ ] No login, no wallet; may carry the operator's brand
- [ ] Agent keys listed with label and exact permissions from the access key list
- [ ] Refusals shown as outcomes with reason codes (`ARUNA_*`), not errors
- [ ] Recorded exposure described as what was sent, not position value
- [ ] Verify commands for every claim on the page

## F4 — Console · branch `ui/f4-console`

Owner and operator see different actions; the operator sees plainly what it cannot do.

- [ ] Wallet connect (owner/operator), role-aware actions
- [ ] Exposure now, agents, targets with class badges and recent class changes
- [ ] **Policy-to-price panel**: changing daily cap or the riskiest allowed class moves the premium in the same view (non-negotiable 2). Premium parameters come from the contract team; label as assumption
- [ ] Refusal log from `@aruna/indexer`, not RPC per page load
- [ ] Migration flow to a new vault version (Stage 6)
- [ ] Owner can remove the operator

## F5 — Coverage and underwriter · branch `ui/f5-coverage`

- [ ] Coverage purchase states both trust assumptions (attestor, arbiter) at the point of purchase
- [ ] Stale attestor heartbeat visible wherever coverage is sold or shown
- [ ] Coverage labelled testnet with assumed numbers until release gate B
- [ ] Underwriter view: capital deployed/locked, **concentration on a single code implementation** given top weight, claims pending/disputed/paid, attestor liveness
- [ ] Payout shown as formula output with the arithmetic visible, not as measured loss

## F6 — Hardening and submission · branch `ui/f6-hardening`

- [ ] End-to-end run from a fresh clone: install, build, serve `out/`, classify an account
- [ ] Component tests for every non-negotiable above
- [ ] Bundle size and load time on the static build
- [ ] Remove all stub data and `STUB-*` strings (grep must return nothing)
- [ ] Demo screenshots/video for the submission post
- [ ] Checklist from `BUILD-PLAN.md` "Submission checklist for v0" reviewed for UI items

---

## Open items needing a decision from others

| Item | Owner | Blocks |
|---|---|---|
| `classifier-core` and `rpc` packages | engine team | F1 |
| Expose monitored `view_account.code_hash` in `ClassEvidence` | engine team | F1 side-by-side with real data |
| Premium parameters for the policy-to-price panel | contract/pool team | F4 |
| Static host for the deploy | project owner | F2 |
| Fallback RPC endpoints and their CORS | frontend | F1 |

## Change log

| Date | Phase | Change |
|---|---|---|
| 2026-11-08 | F0 | Scaffold, stub adapter, result view |
| 2026-11-08 | F0 | Verify panel; CORS tested with curl on both FastNEAR endpoints |
| 2026-11-09 | F0 | This plan written; branch `ui/f0-scaffold` created |
