# Documentation index

Start with [`../README.md`](../README.md) for what Aruna is and how to try it, and
[`../CLAUDE.md`](../CLAUDE.md) for conventions and how to build and test.

## Product

| Document | What it holds |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Who the product is for, the problem in three layers, the roadmap and the release gates |
| [FRONTEND.md](FRONTEND.md) | The four UI surfaces, the question each must answer, and the non-negotiables two tests enforce |
| [UI-STYLE.md](UI-STYLE.md) | Visual language, fonts and colour roles |

## How it works

| Document | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The pieces and how they connect |
| [CLASSIFIER.md](CLASSIFIER.md) | The four classes, the three RPC reads, and the full procedure |
| [CONTRACTS.md](CONTRACTS.md) | Vault, registry, pool and factory: methods, events and the canonical `ARUNA_` reason codes |
| [SDK.md](SDK.md) | The typed client and the compatibility contract |
| [MCP.md](MCP.md) | The MCP tools an agent can call, keyless ones first |
| [ATTESTOR.md](ATTESTOR.md) | Drift detection, the challenge window, claims and the freeze |
| [DECISIONS.md](DECISIONS.md) | Every design decision, D-01 to D-71, with what was rejected and why |
| [NEAR-SKILLS.md](NEAR-SKILLS.md) | The official NEAR sources to check instead of guessing |

## Evidence

| Document | What it proves |
|---|---|
| [NEAR-FACTS.md](NEAR-FACTS.md) | What the sandbox lab measured, including five things that are impossible on NEAR |
| [SELF-CLASSIFICATION.md](SELF-CLASSIFICATION.md) | Aruna's own vault classified by Aruna's own engine |
| [AUDIT-v0.md](AUDIT-v0.md) | Internal contract review. Not a third-party audit |
| [TESTING.md](TESTING.md) | What is tested, how, and the invariants |
| [CONSOLE-TESTING.md](CONSOLE-TESTING.md) | Recorded console runs with transaction hashes, and what is still unproven |
| [COMPONENT_MAP.md](COMPONENT_MAP.md) | Every component, who calls it, and the gaps found while mapping |

Evidence that is not prose: [`../measurement/`](../measurement/) (the mainnet measurement, its
query and raw data), [`../lab/`](../lab/) (sandbox protocol tests) and
[`../packages/sim/results/`](../packages/sim/results/) (the pool simulation).

## Operations

| Document | What it holds |
|---|---|
| [DEPLOY-INDEXER-RAILWAY.md](DEPLOY-INDEXER-RAILWAY.md) | Deploying the indexer, and its recorded runs |
| [DEPLOY-ATTESTOR-KEEPER-RAILWAY.md](DEPLOY-ATTESTOR-KEEPER-RAILWAY.md) | Deploying the attestor and keeper, their recorded runs and measured gas |
