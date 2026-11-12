# Submission — NEAR hackathon, release v0

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
- **Publishing the site.** It publishes under the owner's Vercel account; the settings are in the L6 notes of `docs/ILHAM-PLAN.md`.
- **A Linux or macOS run of the README.** Only Windows was available; step 1 above lists what differs there.
