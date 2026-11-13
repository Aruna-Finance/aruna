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
- Screens that run before the SDK/indexer exist read from a **data port** with a mock adapter, and the team knows
  they are mock (the user removed the on-screen marker). Nothing simulated may be described in the README as a live result.
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

Deadline for v0: **14 November 2026, 23:59 UTC**. F0–F2 are the committed UI scope. F3–F4 only if time. F8 runs against whatever has shipped.

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
| Seven-plus role views | Keep owner, operator, underwriter, counterparty, developer. **Attestor console: built on mock data; confirm ownership with the engine team before it ships** | `FRONTEND.md` lists four surfaces; attestor tooling may belong to the attestor package |
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
- [ ] (static pass done 2026-11-10: token contrast computed, no fixed-width overflow found at 360px except one fixed in Lookup; real-browser look still open) Responsive check to 360px, keyboard pass, contrast check, look in a real browser
- [x] Live RPC client: the earlier version was deleted at the user's request; rebuild when `@aruna/rpc` exists

Blocked on the engine:
- [ ] Replace `lookup()` with `classify(accountId, fetchRpcReader(network))`; delete `classifier-types.ts` and the stub
- [ ] Browser-origin CORS check in a real browser (curl-only so far)
- [ ] Test: no-contract account is not shown as a global-contract account (both report a zero `code_hash`)
- [x] Test: `local_upgradeable` always renders its basis; `upgrade_imports` never reads "can be upgraded"
- [ ] Ask the engine team to expose the monitored `view_account.code_hash` in `ClassEvidence`

Acceptance: a static build served by a plain static server shows the whole landing page; a real testnet and a real
mainnet account classify live once the engine lands; every link either works or is visibly marked as coming.

## F2 - Spec and Lab results pages · `ui/f2-spec-proof`

- [x] `/spec/` page (built as a static route): closed detection routes, limits, assumption register, three contracts, coverage state machine
- [x] `/proof/` page (built as a static route, data in `src/lib/facts.ts`): lab results copied from `NEAR-FACTS.md` with exact error strings; state they ran under the older gas-key model
- [x] Navbar and footer links to these pages go live; the assumption chip on the pricing dial links to the register
- [x] Stage 2 measurement section on `/proof/` (source, window, blocks, reproduce command), numbers generated from `measurement/results/` by `apps/web/scripts/sync-measurement.mjs`
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
- [x] ~~Persistent "Simulated data" marker~~ removed on the user's request: the backend team already knows the data is mock
- [x] Twelve section routes as static pages (`/console/dashboard/`, `/console/agents/`, ...) that name the phase that builds them; not-found page
- [x] Role follows the route: a deep link to a screen the current role lacks switches role; role kept in `localStorage`, optional
- [x] 5 tests on the navigation table (every item has a screen, homes exist, role switching, no em dash) and 2 boundary tests (console code is not imported by the landing; no wallet libraries outside the console)

Next steps, one at a time:
- [ ] Shared pieces: toast, tx dialog (signer, receiver, actions, note, confirm and cancel, Escape closes), table, tabs, crumb, copy button, empty states
- [ ] **Data port**: one interface per data need (`AgentsReader`, `TargetsReader`, `ExposureReader`, `ClaimsReader`, ...) with a mock adapter; replaced by `sdk` and `indexer`
- [ ] Role-aware actions: the operator sees what it cannot do, with the reason
- [x] Detail routes `agents/<agent>`, `targets/<target>`, `claims/<report>`; the public agent page `p-<agent>` belongs to F4
- [ ] Sidebar "Everyone" group links to the classifier and public pages (now internal links, same app)

Notes: the simulated signer names (`budi.testnet`, `opsdesk.testnet`, ...) are the prototype's mock values.
One `pnpm dev` in `apps/web` serves the landing and the console; no second port.

## F4 - Public pages (no login) · `ui/f4-public-pages`

Maps to `FRONTEND.md` surface 3. Needs a deployed vault and `sdk` for real data.

- [x] Look up an agent by vault, label or public key
- [x] Public agent page: what the agent **cannot** do and who enforces it; owner and operator limits; limits and usage today; exposure by class; verify commands. One `view_access_key_list` call backs most of it
- [x] Refusals shown as outcomes with `ARUNA_*` reason codes
- [x] Targets table (list): class, certainty, premium effect, last recorded, freshness, evidence reachable per row. Data port `TargetsReader` with a mock adapter (`src/console/data`), `MAX_CLASS_AGE_BLOCKS = 7200` is the prototype's assumption
- [x] Target detail with the four drift channels and stored evidence (`/console/targets/detail/?id=`)
- [x] Reports and claims list and report detail, readable by everyone
- [x] Recorded exposure described as what was sent, not position value
- [x] Copy-link for the page

## F5 - Owner and operator console · `ui/f5-owner-console`

- [x] Overview (mock data): vault tile, active agents, recorded exposure, premium for current policies, agents table with freeze and resume, contracts touched, cost of protection with tightening options, who controls the vault, recent events. Create-agent button waits for the wizard
- [x] Agents list and agent detail (`/console/agents/detail/?id=`) with six tabs: overview, policy, activity, funds and allowance, coverage summary, key and proof. Freeze, resume and revoke through the tx dialog. Counted refusals shown instead of a score (the threshold is not in the docs). **Left out on purpose: the prototype's "try a call" policy trail and the ten-request reservation test, because they are an in-browser model of contract behaviour**
- [x] Create-agent wizard (`/console/agents/new/`): identity, policy, targets, funding, review, with the live price panel above every step; the done screen shows the connect snippet and what the protocol refuses. No key is created (mock), as in the prototype
- [x] **Policy-to-price panel**: Overview tightening options, the Policy tab (limits, class, targets move the premium and show the delta before saving) and the wizard price panel (non-negotiable 2; mock model)
- [x] Coverage list (`/console/coverage/`) and buy flow (`/console/coverage/buy/`, `?agent=` preselects): both trust assumptions shown at purchase (non-negotiable 7); a stale attestor heartbeat blocks the buy and says why (non-negotiable 8); owner-only. Premium, pool checks and the waiting and challenge periods are the prototype's assumptions, labelled as such, on mock state in `data/coverage-mock.ts`
- [x] Migration (`/console/migrate/`): the four steps, versions in a drawer, owner-only start through the tx dialog; moves the mock vault to v2 and re-keys live agents. Coverage does not transfer
- [~] Owner can remove and restore the operator (done on the Overview). Operator cannot resume or loosen limits (the mock store refuses with `ARUNA_NOT_OWNER`, tested); withdraw waits for funding screens
- [~] Wallet connect (not started); every state-changing action goes through the tx dialog (`console/ui/TxDialog.tsx`: signer, receiver, actions, note, confirm and cancel, Escape closes)

## F6 - Underwriter and attestor · `ui/f6-underwriter-attestor`

- [x] Pool view: concentration by code hash given top weight, capital deployed and locked, claims pending/disputed/paid
- [x] Claims view with challenge window and dispute state; conflicting-report flow if it is a UI surface
- [ ] (prototype model shipped and labelled; reading `@aruna/sim` output waits on that package) Simulation view reading `@aruna/sim` output; assumptions listed, the scenario that breaks the pool shown as it is
- [x] Attestor console (built on mock data; ownership with the engine team is still unconfirmed, see the open items); heartbeat, monitored targets, report drift
- [x] Payout shown as formula output with the arithmetic visible

## F7 - Developer and demo · `ui/f7-developer-demo`

- [x] MCP/SDK reference: keyless tools, vault tools, reason-code table matching the contract set, what is deliberately left out
- [~] Playground (`/console/playground/`): reads the real testnet vault the examples act on and gives the commands; `aruna_simulate` is not run in the browser (see log)
- [x] Guided demo (`/console/story/`, eight steps) on the mock stores, with one step reading the real testnet vault; the live step is labelled

## F8 - Hardening · `ui/f8-hardening`

- [ ] End-to-end run from a fresh clone: install, build, serve `out/`, classify an account
- [x] Component tests for each non-negotiable (`console/nonNegotiables.test.tsx`: 1, 5, 6, 8, 9 and the trustless scan; 2, 3, 4 and 7 are covered by screens and data tests)
- [ ] Bundle size and load time on the static build; accessibility audit
- [x] `grep -r "STUB-" apps` returns nothing; no simulated screen without its marker
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
| 2026-11-09 | F4 | Branch `ui/f4-public-pages` from `main` after F3 merged (PR #4). Step 1: Targets screen with the first data port (`TargetsReader`, mock of four targets, one per class, one stale); `Evidence` moved from `landing/components` to `shared/` since the console reuses it. 22 tests pass |
| 2026-11-09 | F4 | Targets matched to the prototype: its seven seeded targets and nine test cases (`TargetsReader.presets/classify`, mock only, classes are the prototype's stated results, no classification logic), "Classify a new target" panel with toasts, per-row evidence disclosures removed on request. Row to detail link waits for the target detail route. 22 tests pass |
| 2026-11-09 | F4 | Removed the "Simulated data. Nothing is signed or sent." strip from the console shell (user: the backend already knows it is mock). Deviation from the earlier rule that simulated screens carry a marker; README must still not describe mock results as live |
| 2026-11-09 | F4 | Targets table and the classify panel wrapped in the landing card style (`border-line-2 bg-paper p-6 md:p-8`) |
| 2026-11-09 | F4 | Console sidebar stays in view while the page scrolls (sticky under the 57px top bar on large screens, scrolls inside itself if long) |
| 2026-11-09 | F4 | `SmoothScroll` (framer-motion) moved from the root layout to `app/(landing)/layout.tsx`; the console scrolls natively |
| 2026-11-09 | F4 | Targets table: header cells never wrap (one line); rows wrap as before |
| 2026-11-09 | F4 | Console content is full width: page max-width removed from Targets and the placeholder screens. Paragraph line-length limits kept |
| 2026-11-09 | F4 | Targets: "Last recorded" and "Freshness" cells never wrap |
| 2026-11-09 | F4 | Targets: "Last recorded" and "Freshness" cells and the freshness chip never wrap |
| 2026-11-09 | F4 | "Classify a new target" moved into a right-hand drawer opened by a button (new `shared/Drawer.tsx`, native dialog: Escape and backdrop close, focus trapped, slide-in via `--animate-drawer-in`, off with reduced motion). The targets table now uses the full width |
| 2026-11-09 | F4 | Drawer smoother: slide-out and backdrop fade on close (Escape and backdrop click go through the parent so the exit plays), softer easing on open; reduced motion closes at once |
| 2026-11-09 | F4 | Drawer content hides its scrollbar but still scrolls (wheel, touch, keyboard) |
| 2026-11-09 | F4 | Console content area uses the landing wash grey (`bg-wash`, as in the "Three layers" section); top bar and sidebar stay white, cards stay white |
| 2026-11-09 | F4 | Step 1 merged to `main` (PR #5). Next: Client menu (Overview, Agents, Coverage, Migration) in F5; target detail and Claims remain in F4 |
| 2026-11-10 | F5 | Branch `ui/f5-owner-console` from `main` after pulling the team's backend (real `classifier-core`, `rpc`, `sdk` with `readVault`; run `pnpm install` and build `@aruna/classifier-core` and `@aruna/rpc` before `pnpm --filter @aruna/web build`). Step 1: Overview screen with a mutable mock vault store (`data/vault-mock.ts`, shapes follow the SDK `VaultView`), console pricing (`pricing.ts`, tightening options), `Panel`, `TxDialog`, `ClassTag`. 35 tests pass |
| 2026-11-10 | F5 | Overview follows the Targets pattern: tables full width in cards; Cost of protection, Who controls this vault and Recent events open in the right `Drawer` from three header buttons. `Select` now portals into an enclosing `<dialog>` so its list works inside a drawer |
| 2026-11-10 | F5 | Step 2: Agents. List, detail with six tabs, create wizard. Agent detail takes the id from the query string (`?id=`) because agents are created at runtime and a static export cannot pre-render them; `agents/` has its own route folder. One `TxProvider` in the console layout owns the confirmation dialog. Mock store gained add agent, deposit, owner-only withdraw and allowance, ceiling checks and tighten-only for operators. 39 tests pass |
| 2026-11-10 | F5 | Step 3: Coverage list and buy, Migration. Branch `ui/f5-coverage-migration` from `main` after PR #8. Coverage store holds the owner's three policies plus other owners' policies for the concentration check; attestor-2 is silent in the seed, so router targets cannot be bought (shown with the reason). Agent detail Coverage tab now lists the agent's policies and links to the buy flow. 48 tests pass |
| 2026-11-10 | F5 | Removed the "Testnet only, with assumed numbers" banner from Coverage and Buy (user request). The assumptions stay labelled where they are used |
| 2026-11-10 | F4 | Claims: list (`/console/claims/`) and report detail (`/console/claims/detail/?id=`), readable by every role. Mock store `claims-mock.ts` has an empty seed as in the prototype; a "Simulate a drift report" panel (mock only, stands in for the attestor console in F6) opens a report on a target, with one claim per covered policy. Timeline, payout formula, the five conditions, skip challenge window, conflicting report and arbiter ruling follow the prototype. Deviation: "approved" is folded into "paid" (no separate approved state). `coverageStore` gained `book()` so claims can read every policy |
| 2026-11-10 | F4 | Target detail (`/console/targets/detail/?id=`): how the class was reached, why hash monitors miss a global target (lab table), check-it-yourself curl blocks, stored evidence, the four drift channels and the client agents on the target. Target ids in the Targets table now link to it. Deviations: "how reached" and channel states are derived from the stored evidence and the frozen flag, because the record carries no step log; channels that do not apply to a code reference show "not applicable"; no Refresh button, since the mock cache is never stale. `BASIS` moved to `classInfo.ts`, `Freshness` to `ui/Freshness.tsx`. Targets now has its own route folder
| 2026-11-10 | F4 | Look up and public agent page, read LIVE from testnet through `@aruna/sdk` `readVault` (new workspace dependency of `apps/web`; build `@aruna/sdk` before the web build). Routes `/console/lookup/?vault=` and `/console/lookup/agent/?vault=&key=`; default vault `demo2.factory.arunafi.testnet`, checked read-only (owner, operator, 2 agents, 0 full-access keys). Failed reads show as an ordinary outcome. Amounts are yoctoNEAR shown as NEAR with integers only (`yoctoToNear`, tested). Deviations: lookup takes a vault account only (no label or key search); the page omits recent refusals, coverage and exposure-by-class, because `readVault` does not return them; token unit is NEAR, not the prototype's USDC
| 2026-11-10 | F7 | MCP and SDK reference at `/console/developers/`: keyless tools (with `aruna_read_vault`), vault tools, refusal reasons with the auto-disable column, what is deliberately left out, and the two examples. Static, copied from `docs/MCP.md`. `developers.test.ts` asserts the reasons table equals `@aruna/sdk` `REASONS` and `AUTO_DISABLE_REASONS`. Playground and guided demo are not built; they need `aruna_simulate` against a real agent
| 2026-11-10 | F5 | Token marks: the USDC and NEAR logos from `public/images/` replace the ticker text in form inputs only (`NumberField` suffix, via `ui/Token.tsx`). Amounts shown elsewhere stay as text on request. `NumberField.suffix` now takes a node. The `alt` text keeps the ticker
| 2026-11-10 | F8 | Branch `ui/f8-hardening`. Static export served and every route checked: 18 routes 200, unknown route 404, no JS chunk over 300 KB, `out/` 3.7 MB. Non-negotiable gaps closed: `ClassTag` takes a `target` and links to its evidence (5), carries the class basis as hover text (9); `HeartbeatAlert` added to the agent Coverage tab (8). New `nonNegotiables.test.tsx`; `vitest.config.mjs` adds the `@/` alias; `@types/react-dom` added. Inputs show a focus ring. 63 tests pass. Not done: a real-browser accessibility audit and a wallet test
| 2026-11-10 | F8 | Fresh-clone run from `main` (67fdc6f): `pnpm install`, `pnpm -r build`, `pnpm -r test` all green. Counts: classifier-core 47, rpc 32 (3 skipped), cli 8, sdk 12, mcp 6, apps/web 63. README step 1 corrected for sdk and mcp. Deploy is open: no CI workflow or host exists, and a repo-subpath host would need a `basePath`
| 2026-11-10 | F6 | Pool (`/console/pool/`, underwriter home) on mock data: capital, coverage sold, premiums, claims paid; concentration against the 20% group cap with the largest group first; the largest-group worst case; add and withdraw capital (withdraw is locked while a challenge window is open); depositors. `pool.ts` has the pure grouping, `pool-mock.ts` the store, 8 tests. Deposits raise the capital the coverage checks use. Deviation: grouping offers implementation and global-contract owner only; the prototype's "upgrade authority" has no field in the classifier evidence, so it is not shown. Simulation and the attestor console are not built
| 2026-11-10 | F6 | Simulation (`/console/simulation/`): five scenarios, final capital, paid and unpaid, max drawdown, chance of insolvency over 200 runs, an SVG capital chart with the required-capital line and the first-unpaid-claim day, a data table, the input assumptions and an editable starting capital. The model is ported from the prototype to `data/simulation.ts` (seeded, 6 tests) and labelled a prototype of the model: `packages/sim` is empty today. When `@aruna/sim` exists the screen should read its output and this file goes. A breaking scenario is shown as it happens
| 2026-11-10 | F7 | Guided demo (`/console/story/`, in every role's sidebar) and Playground (`/console/playground/`). Demo: eight steps run in order on the mock stores (classify, operator adds an agent, tighten and see the price fall, buy coverage, drift report, payout, false report to the arbiter); step 3 reads the real testnet vault and shows the injected agent's state, labelled "live testnet read". Restart reloads the page, since the state is in memory. 4 tests with an injected reader. Deviations from the prototype's ten steps: "send a swap" and "run the injected agent" are not simulated, because they would need the vault's policy checks in the browser (rule 10); the freeze step is not shown, since the mock targets have no freeze. Playground: no in-browser `aruna_simulate`, for the same reason; it gives the commands for the two example agents and reads the demo vault live
| 2026-11-10 | F6 | Attestor console (`/console/attestor/`, attestor home) on mock data, built without waiting for the ownership answer (the user asked why it was not done; no technical blocker). Pending detections with "Prepare the report", stale-heartbeat alert with a Restart button, bond / locked / slashed / reports per attestor, monitored targets with the four channels and an "Upgrade target" simulation (global-contract redeploys name the other targets they affect), the report form (target, attestor, channel, blocks since the change, hash after; equal hashes and a lookback above the bound are refused), the reports list. `channelsOf` moved to `data/channels.ts` and Target detail now shows a pending change. `claimsStore.reportDrift` takes options; `coverageStore.restartAttestor` added. 5 tests. If the engine team owns this surface, the screen can be dropped. Targets are not frozen by a report (the mock targets have no freeze)
| 2026-11-10 | F2 | Mainnet measurement section on `/proof/`: class and basis tables with share of calls, the three `global_by_account` accounts, failed reads, source folder, block range and the reproduce command. `scripts/sync-measurement.mjs` copies the numbers from `measurement/results/2026-11-10/` into `measurement-data.json`; `measurement.test.ts` re-derives them from that folder. No number typed by hand |
| 2026-11-10 | F3 | Wallet connect (login only) in the console header: `WalletContext` + `WalletButton` using `@hot-labs/near-connect` 0.12 (package and API from docs.near.org wallet-login page, typings checked), testnet, imported dynamically so the static build never runs it. Connect, show account, disconnect, restore a saved session. No screen signs or sends a transaction yet; the role signer label stays mock. `@hot-labs/*` added to the boundary test so it cannot reach the landing code. Not tried against a real wallet in a browser |
| 2026-11-10 | F1 | Landing buttons renamed: navbar "Open the console" (to `/console/`), closing section "Run the guided demo" (to `/console/story/`). The old label said demo for what is now a four-role console with live testnet reads and wallet login |
| 2026-11-10 | F8 | Wallet-aware Lookup: with a connected wallet, Lookup says whether the account is the vault owner, the operator or neither, from the vault's own fields (`walletRole.ts`, tested). Static accessibility pass: contrast computed for text token pairs (all >= 4.5:1 except `dawn-ink` on `fog` at 4.31, which no screen uses); Lookup input no longer overflows at 360px; connected account in the header truncates on small screens. Eight checklist items ticked after checking the code. A real-browser check is still open
| 2026-11-11 | F3 | Console L1 (lane B, U4): `wallet-transport.ts` (VaultTransport over the connected wallet, testnet only, preview before the wallet opens), `tx-status.ts` (signing, confirmed, refused, failed, cancelled), `history.ts` (live, behind with pending rows, unavailable with the last known block; recorded fixture until `NEXT_PUBLIC_INDEXER_URL` is set), `TxDialog` shows method, deposit and gas and the result with an explorer link. Mock actions behave as before. Tried with a real wallet: set_ceiling with 1 yoctoNEAR confirmed on testnet, decline path sends nothing
| 2026-11-11 | F3 | Console L2 (lane B, U5): `/console/create/` screen. Name check, operator choice, targets offered only when `registry2` (read from the factory's `get_config`) holds a class for them, funds check with faucet links (a short balance builds no transaction), `create_vault` via the wallet transport with the deposit shown, then a setup checklist read from chain, a deposit button (plain transfer) and "Your vaults" from the indexer or the recorded fixture. `swap.arunafi.testnet` has no class on registry2 and `drift-target` is frozen, so the picker shows only what the registry returns. Typecheck, 163 tests and the build pass; not yet tried against a real wallet |
| 2026-11-11 | F3 | Console L3 (lane B, U6): agents are live. `agent-keys.ts` (browser ed25519 keys per network and vault), `agent-actions.ts` (which role may do what, with reasons; policy checked against the ceiling by field), `useLiveVault`, `useLiveActions`, live Agents list, Create an agent wizard, agent detail (overview, policy, activity, funds, key and proof), and owner settings (operator, ceiling). The sample agent list, wizard and detail were removed; with no vault selected the screens say so. The mock vault store remains for Overview, Migration, Story, TargetDetail and Coverage. Verified on testnet: add agent (test page and wizard), pause, resume, revoke (test page). Policy, funds, operator, ceiling, and pause, resume, revoke from the screens: tests and build only, not shown on chain |
| 2026-11-12 | F3 | Console L4 (lane B, U7): the Playground is live. `data/playground-scenarios.ts` (attempts, same order as the recorded run in `examples/README.md`, pinned by a test), `data/playground-checks.ts` (agent active, key in this browser, swap target in the ceiling, enough balance, each with a reason and a fix link), `data/playground-run.ts` (one attempt at a time, stops on auto-disable, on a failure or on Stop; interrupted-run marker), and `screens/Playground.tsx` (real `AgentVault` with the key held in this browser). `examples/` is not touched: the list lives in the web app until it is agreed with Aris to move it to `examples/scenarios.ts`. Verified on testnet by script through the same runner and SDK, not by clicking the screen |
| 2026-11-12 | F3 | Console L5, first half (lane B, U8): `ActivityList`, `ExposureHistory` and `HistoryBlock` (reading, unavailable since block N, behind with pending rows, sample data labelled), `useVaultHistory` (15 second refresh), the agent Activity tab shows refusals with reason, class at refusal and a transaction link plus an exposure table, and the Overview is live from `readVault` and history. Deviation: the mock overview and its Cost, Control and Events drawers were removed; Cost returns with the policy-to-price panel, Control lives in the agent settings, Events became the Recent activity panel. The pool-quote panel (`quote.ts`, `PolicyFields`, `pricing.ts`) is not started |
| 2026-11-12 | F3 | Console L5, second half (lane B, U8): the policy-to-price panel. `quote.ts` in the SDK accepts a proposed policy and the pool prices it; the agent Policy tab shows the on-chain price and the draft price side by side, the draft labelled "proposed, not yet signed", with "Testnet, assumed numbers". `pricing.ts` is gone from the live path (mock kept as `data/story-pricing.ts` for the story). The separate "Apply" button is the policy form's save button. Verified read-only against `pool2.arunafi.testnet` by script, not in a browser |
| 2026-11-12 | F3 | Console L5 closed with open items. Proven in a browser: price panel, tighten from the Policy tab (Daily cap 0.4 to 0.2, then On chain now equals Draft), Overview. Open and why: the indexer part (A1, A3, A4) waits on a healthy hosted indexer, which is stopped about 370,000 blocks behind; Stop and the interrupted notice (P4, P5) are unit-tested only; loosen back was not run. The SDK `quote.ts` edit needs Aris told. Details in `docs/ILHAM-PLAN.md` L5 |
| 2026-11-12 | F3 | Console L6, documentation part: README steps 5e (run an agent), 5f (overview and policy price) and 5g (history, stated as not met), updated 5b, 5d and the v0 table; `docs/FRONTEND.md` browser agent keys (R18); `docs/BUILD-PLAN.md` status; `NEXT_PUBLIC_INDEXER_URL` in `.env.example`. Not done: publishing the static site, the fresh-wallet F1 run, the submission checklist |
| 2026-11-12 | F3 | Console L6, evidence part: F1 flow by script on `f1pbr5p.factory2.arunafi.testnet` (create, add agent, honest swap, tighten, five refusals, auto-disable), clean-clone check of `main`, secret scan and history search; README step 1 notes two Windows-only test failures; credits list the web libraries. Not done: a person's F1 run on screens, publishing the site, the indexer, the submission items that need the owner's accounts |
| 2026-11-13 | F3 | Console L7, first half: Coverage list, Buy page and Claims page read the pool and registry (no mock); `useVaultCoverage`, `useVaultClaims`, `useCoverageBuy`, `useClaimAction`, `data/coverage-live.ts`, `data/coverage-buy.ts`, `data/claims-live.ts` with tests; `headBlock` in `chain-reads.ts`; Create page no longer says "No vaults found" without an indexer. Not done: a real purchase and claim, USDC, ReportDetail, ExposureBefore, mock stores still read by Attestor, Pool, TargetDetail |
| 2026-11-13 | F3 | Console L7 docs: README step 5h (Coverage, Buy and Claims read from the pool; four `fixtures/tools.mjs view` commands that reproduce the screens; the purchase and claim from the console stated as not met); the 5b list of live screens and the v0 table updated |
| 2026-11-13 | F3 | Console L7: `ReportDetail` live. Reads `get_report` from the registry; timeline from the registry's state and the challenge window (300 blocks, pinned to `params.rs` by a test); the claims on that report for the chosen vault; links from the Claims page. The mock conflicting-report and arbiter buttons are gone, because those calls belong to the attestor and arbiter accounts. `claims-mock.ts` is still read by Attestor, Pool and TargetDetail |
| 2026-11-13 | F3 | Console L7 polish: token amounts in their own units from the token's `ft_metadata` (`data/token-amount.ts`, `useTokenMeta.ts`), the exposure-before-a-block panel on the Claims page (`ui/ExposureBefore.tsx`, R26), `docs/CONSOLE-TESTING.md` section 5d, and the checklist of what is left before the deadline in `docs/ILHAM-PLAN.md` |
