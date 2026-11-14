# Submission — NEAR hackathon, release v0

> Superseded on 14 November 2026. The README is the current record; the status, video script and X post
> below are from 12 November.

Deadline: **14 November 2026, 23:59 UTC**. Checklist source: `docs/BUILD-PLAN.md`.

## Project description (1,353 characters, limit 2,000)

> Aruna measures whether the contracts an agent touches can still change, and found a class that can
> change without any transaction touching them and without the field everyone monitors ever
> changing. On NEAR an account can run a global contract published by another account: when the
> owner redeploys, the account runs new code while view_account.code_hash stays the zero hash. Aruna
> classifies any NEAR account as immutable_verified, local_upgradeable, global_by_account or unknown
> from three public RPC reads, with evidence anyone can reproduce, through a zero-dependency engine,
> a static web page, a CLI, an SDK and a keyless MCP tool agents call before sending funds. Across
> the 1,000 most-called mainnet contracts, 44.2% of function calls went to contracts a full-access
> key holder can replace at any moment and 0.4% to contracts with no detected upgrade path; three
> global_by_account contracts are live on mainnet. On top sits a vault for agent-as-a-service
> companies: client as owner, company as operator, agents as function-call keys the vault manages
> itself. Built by a factory from one global contract with no key, the vault classifies itself as
> immutable_verified on testnet, re-checks a target's class at execution, reserves against daily
> caps under parallel calls and auto-disables injected agents. Verifiable and reproducible, not
> trustless.

### Status on 12 November 2026

Done and checked again today:
- Repo public with the MIT licence (`gh repo view`: `PUBLIC`, `mit`).
- `bash scripts/secret-scan.sh`: `secret-scan: clean`. On Windows `pnpm secret-scan` fails because the script is bash; run it with `bash`.
- History search over every branch for a QuickNode URL token, a long `ed25519:` private key and `private_key`/`secret_key` assignments: no match; no `.env`, credentials or key file is tracked. A pattern search, not a scanner.
- A fresh clone of `main` at `d81cb0b`: `pnpm install` and `pnpm -r build` succeed; tests pass in `classifier-core` 47, `rpc` 32, `attestor` 13, `cli` 8, `mcp` 22 and `apps/web` 244. Two tests fail on **Windows only**: `sdk` `abi-drift` (passes once the clone is checked out with LF line endings, which I confirmed) and `indexer` `cli.test.ts` "read-only directory" (a file-permission test that Windows does not honour). A Linux run was not done here.
- The README names the AI coding agent and the libraries it asks for.

Not done, and why:
- **Demo post on X, video, payout account, track selection, and pressing submit.** They need the owner's accounts and decisions; none can be done from this repository.
- **A person's F1 run with a fresh wallet, recorded on screens** (for the video). It needs a wallet and someone at the browser. The chain part is proven by script (`docs/CONSOLE-TESTING.md` section 5c).
- **A hosted indexer behind the live site.** The hosted one is stopped about 370,000 blocks behind (`docs/ILHAM-PLAN.md`, L5). The README says so (step 5g).
- ~~Publishing the site.~~ Done on 13 November 2026: https://www.arunafi.xyz/ (`arunafi.xyz` redirects to it). Checked from outside: every route answers 200, and the published JavaScript holds no `ed25519:` private key, QuickNode URL or indexer URL. Wallet and chain reads on the live site are checked by hand by the owner.
- **A Linux or macOS run of the README.** Only Windows was available; step 1 above lists what differs there.

## Demo video script (about 3 minutes, draft)

Record on https://www.arunafi.xyz/ with a testnet wallet that holds at least 1 NEAR. Every number below is one this repository already reproduces; say nothing the screen does not show.

1. **The problem, 20 seconds.** Open the classifier page, click `fx-guser.arunafi.testnet`. Say: the field everyone monitors, `view_account.code_hash`, is the zero hash, and the code that runs is somewhere else. Point at the side-by-side table (README step 5). Expected on screen: class `global_by_account`.
2. **Create a vault, 40 seconds.** `/console/create/`: name it, keep yourself as owner and operator, tick `swap.arunafi.testnet`, deposit 0.5 NEAR, sign. Say: no full-access key, created from one global contract. Expected: the new vault opens with Full-access keys 0.
3. **Add an agent, 30 seconds.** Agents, Create an agent, allow `swap.arunafi.testnet`, daily cap 0.4 NEAR, sign. Say: the agent is a function-call key limited to `spend` and `refresh_class`.
4. **Honest agent, 20 seconds.** Playground, choose the agent and Honest agent, Run the scenario. Expected: one line marked Settled with a transaction link.
5. **Injected agent, 40 seconds.** Choose Injected agent, Run the scenario. Expected, in order: `TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`, then "The vault paused the agent". Say: refusals are returned and recorded, they do not revert; the vault paused the agent itself.
6. **Proof without the page, 20 seconds.** In a terminal: `node fixtures/tools.mjs view <vault> get_agents '{}'`. Expected: `"status":"Paused"`, `"auto_disabled":true`.
7. **Close, 10 seconds.** Say: verifiable and reproducible, with two trust assumptions, the attestor and the arbiter. The History panel says "not connected" because the hosted indexer is still catching up; say so if it is still true on the day.

## X post (draft, 279 characters or fewer)

> On NEAR an account can run code published by another account. When the owner redeploys, view_account.code_hash stays the zero hash. Aruna classifies the contracts an agent touches and puts them behind a keyless vault. Try it: https://www.arunafi.xyz/ Code: https://github.com/Aruna-Finance/aruna

Check before posting: the character count (X counts each link as 23), that the link still opens, and that "trustless" does not appear. Attach the video or a screenshot of the five refusals.
