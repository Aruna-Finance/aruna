# UI work log and phase plan

Scope: the frontend only (one Next.js app, `apps/web`: landing, `/spec/`, `/proof/`, and the console under `/console/`).
Requirements live in `FRONTEND.md`; this file tracks **what was done, in which phase, on which branch**.
If they conflict, `FRONTEND.md` wins.

Reference design: the Claude web prototype (artifact `Civ8euCr5XqoSCVZfDL2xh`). It is a flow and visual reference,
not code to port. See "Prototype map" for how each of its screens lands in a phase.

## Rules for every phase

- One branch per phase, named `ui/f<N>-<slug>`. Branch off the previous phase when it is green, not off `main`.
- Never reimplement a classification, policy or pricing check. Consume `@aruna/classifier-core` and `@aruna/sdk`
  (CLAUDE.md rule 10). The prototype's in-browser "core" is a mock of contract behaviour; none of it is copied.
- `apps/web` stays static, keyless and backend-free (non-negotiable 1).
- Screens that run before the SDK/indexer exist read from a **data port** with a mock adapter, and show a visible
  "Simulated data" marker. Nothing simulated may be described in the README as a live result.
- Every phase ends with `pnpm typecheck`, `pnpm test`, `pnpm build` green and its checklist ticked here.
- Commit format: Conventional Commits, no attribution lines. Nothing is committed unless the owner asks.

Non-negotiables from `FRONTEND.md`, checked at every phase review:
1 static check app · 2 policy-to-price visible · 3 public page needs no login · 4 refusals are normal
outcomes · 5 class always has evidence one click away · 6 `unknown` shown as unknown ·
7 two trust assumptions where coverage is bought · 8 stale heartbeat visible · 9 `local_upgradeable` shows its basis.

## Overview

| Phase | Branch | Goal | Depends on | Release |
|---|---|---|---|---|
| F0 | `ui/f0-scaffold` | Static-export app, types, stub adapter, verify panel | nothing | v0 |
| F1 | `ui/f1-landing` | The whole landing page: navbar, live classifier hero, vault diagram, problem, layers, risk classes, pricing dial, roles, SDK, closing footer | `classifier-core`, `rpc` for live classes | v0 |
| F2 | `ui/f2-spec-proof` | Spec and Lab results pages, so nav and footer links go live; deploy; README steps | F1 | v0 |
| F3 | `ui/f3-app-shell` | Console shell in `apps/web` under `/console/`: roles, navigation, design system, data port, tx dialog | F2 | v0 if time |
| F4 | `ui/f4-public-pages` | No-login screens: look up an agent, public agent page, targets, claims | F3, then `sdk` | v0 if time |
| F5 | `ui/f5-owner-console` | Owner and operator: overview, agents, wizard, coverage, migration | F3, `sdk`, `indexer` | after v0 |
| F6 | `ui/f6-underwriter-attestor` | Pool concentration, claims, simulation, attestor console | F3, `pool`, `attestor` | after v0 |
| F7 | `ui/f7-developer-demo` | MCP/SDK reference, simulate and injected-agent playground, guided demo | F4, F5 | after v0 |
| F8 | `ui/f8-hardening` | E2E, accessibility, performance, remove all stubs, submission polish | whatever shipped | v0 |

Deadline for v0: **14 November 2026, 23:59 UTC**. F0–F2 are the committed UI scope. F3–F4 only if time and only with
the "Simulated data" marker. F8 runs against whatever has shipped.

---

## Prototype map

The prototype is one page with two modes. A **site** (landing) and an **app** with six role views, a section
sidebar, a bottom "simulated testnet" dock and a simulated wallet dialog. Routes are hash based.

### Site (landing): one page, top to bottom

| Order | Section (route) | Content | Phase | Notes |
|---|---|---|---|---|
| 0 | Navbar | Floating pill: brand, Classifier, Risk classes, Vault, Coverage, Spec, primary button | F1, F2 | Navbar is a sticky bar with the logo only; Spec links to `/spec/` (F2) |
| 1 | `#check` | H1 "Can this NEAR contract still change under your agent?", input, examples, result with the two fields and how it was reached | F1 | The front door. Live RPC for reads |
| 2 | `#hero` | Diagram: owner policy, agent key, vault, targets, refused target, pool. Heading "A vault acts on the class, then prices what's left." | F1 | Pause control and `prefers-reduced-motion` |
| 3 | `#problem` | Access keys stop at who may be called; three problems; access control vs economic policy table; refusal log | F1 | Refusal log labelled as an illustration |
| 4 | `#layers` | Measurement, Protection, Coverage | F1 | Protection list is the six refusals from `NEAR-FACTS.md` |
| 5 | `#classes` | Four risk classes with certainty and price; "A change most monitors miss" | F1 | Must show basis; `unknown` never styled as safe |
| 6 | `#pricing` | "A tighter policy costs less to cover": sliders, class pills, exposure, premium, premium by class | F1 | Illustrative model, every figure marked assumption |
| 7 | `#roles` | Client, Operator, Anyone checking, Underwriter | F1 | Cards carry no links until the app screens exist (F3 to F6) |
| 8 | `#sdk` | Keyless and vault code samples | F1 | Samples must match `SDK.md` and `MCP.md` |
| 9 | `#trust` (footer) | Closing statement with the two trust assumptions, primary button, legal row | F1 | Spec and Lab results link to `/spec/` and `/proof/` (F2); SDK and MCP, Simulation have no target until F7 |
| - | `#spec` | Limits, closed detection routes, assumption register, three contracts, coverage state machine | F2 | Static page |
| - | `#proof` | Lab results with exact errors | F2 | Copy from `NEAR-FACTS.md`, never retype from memory |

### App, by role → F3 to F7

| Role | Home | Screens | Phase |
|---|---|---|---|
| Counterparty (no login) | `#lookup` | Look up an agent; public agent page `#p-<agent>`; targets `#targets`, target detail `#t-<target>`; reports and claims `#claims`, `#report-<id>` | F4 |
| Client (owner) | `#dashboard` | Overview; agents `#agents`; agent detail `#a-<agent>` with tabs and policy test; create-agent wizard `#agent-new` (5 steps: identity, policy, targets, funding, review); coverage `#coverage`, buy `#coverage-buy`; claims; migration `#migrate` | F5 |
| Operator | `#dashboard` | Same as owner minus migration. Buying coverage shows "the client buys coverage" instead of an action | F5 |
| Underwriter | `#pool` | Pool concentration by code hash; claims; simulation `#simulation` | F6 |
| Attestor | `#attestor` | Monitored targets, heartbeat, report drift, restart | F6 |
| Developer | `#developers` | MCP tool list with reason-code table; playground: `aruna_simulate` and injected agent | F7 |
| Everyone | `#story` | Guided demo in ten steps, shared state with all screens | F7 |

### Shared app pieces → F3

Role switcher, section sidebar, top bar with network badge and signer, toast, transaction dialog (signer, receiver,
actions, note, confirm/cancel), tables with row links, tabs, crumbs, copy-to-clipboard, keyboard Escape to close.

---

## Deviations from the prototype (decided up front)

| Prototype does | We do | Why |
|---|---|---|
| Bottom dock with "+1 hour / +1 day / +3 days" time controls | Not shipped. Only in an explicit demo mode, if at all | Time travel is a simulation device and would misrepresent a live chain |
| In-browser core models policy checks, premium, pool and claims | Replaced by `@aruna/sdk` and `@aruna/indexer`; the mock adapter only returns canned data | Enforcement is the contract's job; two implementations discredit the product (rule 10) |
| Classifier "presets" because the browser cannot reach RPC | Live RPC via `@aruna/rpc` (CORS verified with `curl` on both FastNEAR endpoints) | `apps/web` must be live to count as a measurement |
| Simulated wallet dialog | Real wallet connect in F5; dialog component kept | Non-negotiable: contract decides, UI reflects |
| Premium `0 USDC` when every class is allowed | Show "Not priced" or the contract's figure, labelled assumption | A tighter policy must visibly lower the premium; parameters are not ours to invent |
| Premium rate 2.7% of limit per 30 days, `k`, payout 80% | Display only what the pool contract exposes; mark as assumption until release gate B | `DECISIONS.md` open question 2 |
| Simulation view runs a model in the browser | Reads results of `@aruna/sim` once it exists; until then labelled "prototype of the model" | Prototype itself says it is not a result from `sim/` |
| Seven-plus role views | Keep owner, operator, underwriter, counterparty, developer. **Attestor console: confirm with the engine team before building** | `FRONTEND.md` lists four surfaces; attestor tooling may belong to the attestor package |
| "3 blocks from redeploy to new code" in the hero | Add "single-shard lower bound" | `NEAR-FACTS.md` §5 |
| Navbar and closing button "Open the demo" | Internal link to `/console/` (the prototype opens its app). The prototype lands on the guided demo (`#story`), which is F7, so for now it lands on the console home | The user asked for the console; one app means no external URL or env variable |
| Each landing section is at least one viewport tall | Padding-based sections | Forced full-height sections hide the content below on short screens |
| Links to screens not built yet | Decided by the user: no "soon" labels. Links without a target are left as plain anchors | The user wants the page to read as finished |
| Landing fragments built from simulated numbers (exposure bars, budget bars) | Dropped or replaced by sourced text | No invented figures on the first page |
| Animated vault diagram drawn by script | Static SVG with one calm flow animation, pausable | Same message, far less code and motion |
| "Simulate the owner redeploying" button | Kept for stub examples only, using the lab's real before/after hashes (`73ETF…` to `J2gKR…`), labelled illustration | It is the finding, but a live account cannot be redeployed from a tab |

---

## F0 - Scaffold · `ui/f0-scaffold` · DONE

- [x] Next.js 16.4.5 static export, React 19.3.1, TypeScript 5.9.3, Vitest 5.1.0, versions pinned
- [x] Styling: Tailwind CSS 4.3.5 (`@tailwindcss/postcss`), prototype tokens in `@theme`, no hand-written component CSS
- [x] `src/lib/classifier-types.ts` mirrors `CLASSIFIER.md` (delete when `classifier-core` exists)
- [x] `src/lib/classifier-adapter.ts` stub: four `*.example.testnet` fixtures, implements no check
- [x] Result view: class, basis text, evidence open by default, `unknown` styled as unknown
- [x] `global_by_account` side-by-side: `view_account.code_hash` (wrong) vs `view_code.hash` (true)
- [x] "Verify this yourself": three `curl` commands, bodies copied from docs.near.org
- [x] 3 unit tests for the command builder, including shell-quote safety
- [x] CORS tested with `curl` and a fake `Origin`: OK on `free.rpc.fastnear.com` and `test.rpc.fastnear.com`
- [x] `.gitignore` covers `.next/`, `out/`, `next-env.d.ts`
- [x] Committed locally as `e610416`, `cc5a6a7`, `f926d04`. Push blocked: 403 on `Aruna-Finance/aruna` for account `ollhamm`

Carried forward: placeholder hashes `STUB-hash-*`; zero hash `1111…1111` is a display constant because the evidence
type lacks `view_account.code_hash`; CORS result is from `curl`, not a browser; FastNEAR rate limits unpublished.
Environment: `corepack enable` fails without admin here; pnpm 9.15.4 installed with `npm install -g`.

## F1 - Landing page · `ui/f1-landing`

The complete landing page of the prototype, in its order (see "Site" above), as one static page. The classifier
is its first section, not a page of its own.

Done (merged to `main`, PR #2):
- [x] Styling follows bitnomial.com (`docs/UI-STYLE.md`): square corners, mono uppercase buttons, accent `#FF7756`, IBM Plex self-hosted; column lines only on `#check`
- [x] Shared components: `Button`, `Select` (Radix), `Toaster` (sonner, also catches uncaught errors), `Disclosure`, Phosphor regular icons
- [x] Navbar (logo only, "Open the demo"), one section per screen, `SmoothScroll` (framer-motion)
- [x] `#check` classifier card on the stub adapter, Evidence panel with plain-language rows, examples as pills (stub data, labelled)
- [x] `#hero` vault diagram (static, the user's chosen design with the artifact's names), dark section
- [x] `#problem`, `#layers`, `#classes`, `#pricing`, `#roles`, `#sdk`, closing footer
- [x] Pricing model isolated in `src/lib/premium-model.ts` (mock, assumptions listed under the dial, `unknown` shown as "not priced", 4 tests)
- [x] Copy audit by test and grep: no em dash, no "trustless"

Not done:
- [ ] `#hero` pause control (the diagram is static, so none is needed) and the artifact's vertical mobile layout (the diagram scrolls sideways under 900px)
- [ ] Examples that show every basis, including `upgrade_imports` (the stub has four examples)
- [ ] Responsive check to 360px, keyboard pass, contrast check, look in a real browser
- [ ] Live RPC client: the earlier version was deleted at the user's request; rebuild when `@aruna/rpc` exists

Blocked on the engine:
- [ ] Replace `lookup()` with `classify(accountId, fetchRpcReader(network))`; delete `classifier-types.ts` and the stub
- [ ] Browser-origin CORS check in a real browser (curl-only so far)
- [ ] Test: no-contract account is not shown as a global-contract account (both report a zero `code_hash`)
- [ ] Test: `local_upgradeable` always renders its basis; `upgrade_imports` never reads "can be upgraded"
- [ ] Ask the engine team to expose the monitored `view_account.code_hash` in `ClassEvidence`

Acceptance: a static build served by a plain static server shows the whole landing page; a real testnet and a real
mainnet account classify live once the engine lands; every link either works or is visibly marked as coming.

## F2 - Spec and Lab results pages · `ui/f2-spec-proof`

- [x] `/spec/` page (built as a static route): closed detection routes, limits, assumption register, three contracts, coverage state machine
- [x] `/proof/` page (built as a static route, data in `src/lib/facts.ts`): lab results copied from `NEAR-FACTS.md` with exact error strings; state they ran under the older gas-key model
- [x] Navbar and footer links to these pages go live; the assumption chip on the pricing dial links to the register
- [ ] Stage 2 measurement table slot once the CLI produces it (source, query, date)
- [ ] Deploy to a plain static host; record URL and build command
- [ ] README steps for this app: numbered "do X, see Y", each with an expected result

Acceptance: a stranger follows the README steps and sees the stated results.

## F3 - Console shell · `ui/f3-app-shell`

**One Next.js app (decided by the user, replacing the earlier two-app split).** The console lives in `apps/web` under `/console/`; its code is in `src/console` and `src/app/console`. FRONTEND.md non-negotiable 1 (classifier page static, keyless, no wallet) is kept by a code boundary: nothing outside those two folders may import `@/console/*` or wallet/signing libraries (`near-api-js`, `@near-wallet-selector/*`, `@near-js/*`, `@aruna/sdk`), enforced by `src/console/boundary.test.ts`. The parent docs (`CLAUDE.md` layout, `ARCHITECTURE`, `FRONTEND`) still list `apps/console` as a separate app; the team should update them. Folder layout inside `apps/web/src` (landing and console are separate trees):

```
app/(landing)/   routes: / , /spec , /proof      (route group, URLs unchanged)
app/console/     routes: /console/...
landing/         components/ and lib/ used only by the landing, spec and proof
console/         shell, navigation, role context, tests (the app side)
shared/          Button, Select, Toaster, Disclosure, SmoothScroll
```

Built in small steps; step 1 is the shell.

Step 1 (done, uncommitted):
- [x] Static export (`output: "export"`, no server) already applies to the single app, because wallet and signing are client-only
- [x] Design tokens shared by construction: same `globals.css`, no copy
- [x] Top bar with logo, role switcher (six roles), testnet badge and signer; sidebar per role from the prototype's NAV table
- [x] Persistent "Simulated data. Nothing is signed or sent." marker
- [x] Twelve section routes as static pages (`/console/dashboard/`, `/console/agents/`, ...) that name the phase that builds them; not-found page
- [x] Role follows the route: a deep link to a screen the current role lacks switches role; role kept in `localStorage`, optional
- [x] 5 tests on the navigation table (every item has a screen, homes exist, role switching, no em dash) and 2 boundary tests (console code is not imported by the landing; no wallet libraries outside the console)

Next steps, one at a time:
- [ ] Shared pieces: toast, tx dialog (signer, receiver, actions, note, confirm and cancel, Escape closes), table, tabs, crumb, copy button, empty states
- [ ] **Data port**: one interface per data need (`AgentsReader`, `TargetsReader`, `ExposureReader`, `ClaimsReader`, ...) with a mock adapter; replaced by `sdk` and `indexer`
- [ ] Role-aware actions: the operator sees what it cannot do, with the reason
- [ ] Detail routes `agents/<agent>`, `targets/<target>`, `claims/<report>`; the public agent page `p-<agent>` belongs to F4
- [ ] Sidebar "Everyone" group links to the classifier and public pages (now internal links, same app)

Notes: the simulated signer names (`budi.testnet`, `opsdesk.testnet`, ...) are the prototype's mock values.
One `pnpm dev` in `apps/web` serves the landing and the console; no second port.

## F4 - Public pages (no login) · `ui/f4-public-pages`

Maps to `FRONTEND.md` surface 3. Needs a deployed vault and `sdk` for real data.

- [ ] Look up an agent by vault, label or public key
- [ ] Public agent page: what the agent **cannot** do and who enforces it; owner and operator limits; limits and usage today; exposure by class; verify commands. One `view_access_key_list` call backs most of it
- [ ] Refusals shown as outcomes with `ARUNA_*` reason codes
- [ ] Targets table: class, certainty, premium effect, last recorded, freshness; target detail with the four drift channels and stored evidence
- [ ] Reports and claims list and report detail, readable by everyone
- [ ] Recorded exposure described as what was sent, not position value
- [ ] Copy-link for the page

## F5 - Owner and operator console · `ui/f5-owner-console`

- [ ] Overview: vault, active agents, recorded exposure, premium for current policies, contracts touched, cost of protection
- [ ] Agents list and agent detail with tabs, policy test trail, freeze/resume/revoke, refusal score
- [ ] Create-agent wizard (identity, policy, targets, funding, review) with live price on each step; key shown once, not stored
- [ ] **Policy-to-price panel**: tightening a limit or the riskiest allowed class moves the premium in the same view (non-negotiable 2)
- [ ] Coverage list and buy flow: both trust assumptions shown at purchase (non-negotiable 7); stale attestor heartbeat blocks the buy and says why (non-negotiable 8); owner-only
- [ ] Migration flow: pause, create new vault, move funds and re-register agents, revoke old keys and withdraw. Coverage does not transfer
- [ ] Owner can remove the operator; operator cannot loosen limits, resume an auto-disabled agent or withdraw
- [ ] Wallet connect; every state-changing action goes through the tx dialog

## F6 - Underwriter and attestor · `ui/f6-underwriter-attestor`

- [ ] Pool view: concentration by code hash given top weight, capital deployed and locked, claims pending/disputed/paid
- [ ] Claims view with challenge window and dispute state; conflicting-report flow if it is a UI surface
- [ ] Simulation view reading `@aruna/sim` output; assumptions listed, the scenario that breaks the pool shown as it is
- [ ] Attestor console: **only after confirming ownership with the engine team**; heartbeat, monitored targets, report drift
- [ ] Payout shown as formula output with the arithmetic visible

## F7 - Developer and demo · `ui/f7-developer-demo`

- [ ] MCP/SDK reference: keyless tools, vault tools, reason-code table matching the contract set, what is deliberately left out
- [ ] Playground: `aruna_simulate` against an agent, and the injected-agent run with refusals and auto-disable
- [ ] Guided demo (ten steps) wired to real testnet runs where possible; any simulated step is labelled

## F8 - Hardening · `ui/f8-hardening`

- [ ] End-to-end run from a fresh clone: install, build, serve `out/`, classify an account
- [ ] Component tests for each non-negotiable
- [ ] Bundle size and load time on the static build; accessibility audit
- [ ] `grep -r "STUB-" apps` returns nothing; no simulated screen without its marker
- [ ] Demo screenshots/video; `BUILD-PLAN.md` submission checklist reviewed for UI items

---

## Open items needing a decision from others

| Item | Owner | Blocks |
|---|---|---|
| `classifier-core` and `rpc` packages | engine team | F1 |
| Expose monitored `view_account.code_hash` in `ClassEvidence` | engine team | F1 |
| Is the attestor console a frontend surface? | engine team | F6 |
| Premium and pool parameters for pricing screens | contract/pool team | F2 widget, F5 |
| Write access to `Aruna-Finance/aruna` for `ollhamm` | org owner | pushing any branch |
| Static host for the deploy | project owner | F2 |
| Fallback RPC endpoints and their CORS | frontend | F1 |

## Change log

| Date | Phase | Change |
|---|---|---|
| 2026-11-08 | F0 | Scaffold, stub adapter, result view |
| 2026-11-08 | F0 | Verify panel; CORS tested with curl on both FastNEAR endpoints |
| 2026-11-09 | F0 | First plan written; branch `ui/f0-scaffold` created and committed locally |
| 2026-11-09 | all | Plan rewritten after reading every prototype screen: phases F1–F8 aligned to its menus, deviations listed |
| 2026-11-09 | F1 | RPC client with fallback and error kinds, paginated access keys, account id check, lookup failures as results, live test suite (`ARUNA_LIVE=1`). Class itself still waits for the engine |
| 2026-11-09 | all | Phases corrected: the classifier is the first section of the landing page, not a page of its own. F1 is now the whole landing; spec and proof moved to F2. Branch renamed `ui/f1-landing` |
| 2026-11-09 | F1 | Landing page built and merged (PR #2): Tailwind, bitnomial style, IBM Plex, all sections, mock pricing model, smooth scroll |
| 2026-11-09 | F2 | Branch `ui/f2-spec-proof` from `main`. `/spec/` and `/proof/` built from `NEAR-FACTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `ATTESTOR.md`, `CONTRACTS.md`, `DECISIONS.md` via `src/lib/facts.ts`; nav, footer and pricing chip links live. Deploy and README stay in the F2 list, deploy waits for a host decision |
| 2026-11-09 | F2 | Merged to `main` (PR #3). Open items (Stage 2 table slot, deploy, README) wait for a team decision |
| 2026-11-09 | F3 | Branch `ui/f3-app-shell` from `main`. Step 1: console shell with role switcher, sidebar, simulated-data marker, twelve placeholder routes, not-found page, 5 tests (first built as a separate `apps/console`) |
| 2026-11-09 | F3 | User decision: one Next.js app. Console moved into `apps/check` under `/console/`; `apps/console`, `console-url.ts`, `.env.example` and port 3100 removed; "Open the demo" is an internal link to `/console/`; `boundary.test.ts` guards non-negotiable 1 (19 tests pass). Parent docs still say `apps/console`: team to update |
| 2026-11-09 | F3 | Tidied `apps/check/src`: `landing/` (components, lib), `console/`, `shared/` (5 base components), route group `app/(landing)`. Imports rewritten; typecheck, 19 tests and build green. Folder was still `apps/check` at this point |
| 2026-11-09 | F3 | Renamed `apps/check` to `apps/web` (package `@aruna/web`) because it now holds landing, spec, proof and console. Leftover `apps/console` removed. Parent docs still say `apps/check` and `apps/console`: team to update |
