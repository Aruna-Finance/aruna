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
