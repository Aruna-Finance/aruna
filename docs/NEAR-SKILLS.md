# NEAR skills and official sources

The trusted sources for anything NEAR. If an answer is not here or in `NEAR-FACTS.md`,
**do not guess it.**

---

## Official NEAR agent skills

Repo: `github.com/near/agent-skills`

```bash
npx skills add near/agent-skills
```

The repo contains **eight** skill directories. Its README lists only six under
`--skill`; `near-cli-rs` and `near-contract-audit` exist as directories but are not in
that list. **Install the full pack** so nothing is missed.

| Skill | Covers | Relevance to Aruna |
|---|---|---|
| `near-smart-contracts` | Rust contracts, near-sdk v5.x, state, cross-contract calls, security | **Core.** All contract work |
| `near-contract-audit` | Security audit of Rust NEAR contracts: reentrancy, unhandled promises, unsafe math, access control, callback security | **Core.** Run against the vault before submission |
| `near-api-js` | near-api-js v7: transactions, accounts, keys, FT/NFT, units | Attestor and MCP server |
| `near-kit` | TypeScript SDK, type-safe contracts, sandbox testing, React hooks | Alternative for the web and MCP layers |
| `near-cli-rs` | Non-interactive `near` commands, v0.14+ | Account and key setup, deploys |
| `near-dapp` | Frontend: create-near-app, wallet connection, React/Next.js patterns | Dashboards |
| `near-ai-cloud` | Private inference, TEE attestation | Not used. Aruna runs no model |
| `near-intents` | Cross-chain swaps via the 1Click API | Not used in this scope |

Each skill contains `SKILL.md` plus `references/` and sometimes `rules/`.

> Skills activate automatically when a relevant task is detected. Still read the
> `SKILL.md` explicitly before significant work in that area.

**Note on the classifier core:** it must stay dependency-free (`DECISIONS.md` D-11). Do not pull `near-api-js`
or `near-kit` into it, however convenient — implement the three JSON-RPC calls in each
surface instead. See `DECISIONS.md` D-07.

---

## Documentation navigation

Two files written for agents. Use them to find the right page rather than guessing URLs:

- `https://docs.near.org/llms.txt`
- `https://docs.near-intents.org/llms.txt`

Main docs: `https://docs.near.org`
RPC: `https://docs.near.org/api/rpc`
BigQuery public dataset: `https://docs.near.org/data-infrastructure/big-query`
NEPs: `https://github.com/near/NEPs`

**Always look up contract addresses, endpoints and SDK versions in the documentation.
Never guess them.** This is an explicit rule from the hackathon organizers.

---

## Hackathon

Official `HACKATHON.md`: `https://nearhackathon.com/HACKATHON.md`
Read the live version before submitting — dates and rules can change.

Per-track starter prompts: `github.com/nearai/near-hackathon-prompt-examples`
Relevant track ids: `security`, `agents`, `defi`, `open`.

> Worth reading the `security` track's prompt file to see why five projects converged
> on the same design. It specifies the architecture. See `COMPETITIVE.md`.

Rules that affect the work:

- Repo public before 14 November 23:59 UTC, with a LICENSE (MIT is fine)
- README written for a machine reader: numbered "do X, see Y" steps
- Code from 19 October 2026 counts; earlier commits are baseline
- Libraries and AI-generated code are allowed if named in the README
- Testnet-only projects are eligible
- One submission may select every track it fits
- One person may submit at most two independent projects, each naming the other
- Claude Code and Codex do initial screening: they check the project runs and does what
  the README claims

NEAR AI credits: buy at `cloud.near.ai`, or claim $10 free through NEAR Builders.
Aruna does not need them.

---

## Standards in use

| Standard | Used for |
|---|---|
| NEP-141 | Fungible tokens. The 1 yoctoNEAR requirement is what forces the vault architecture |
| NEP-297 | Event format. All Aruna events use `standard: "aruna"` |
| NEP-611 | Gas keys. **Not used** — see `DECISIONS.md` D-02 |
| NEP-366 | Meta-transactions. **Not used** — DelegateV2 removed at protocol 88 |

---

## Community

NEAR Discord: `https://discord.gg/nearprotocol`
Builders Telegram: `https://t.me/nearbuilderschat`

For questions documentation does not answer — not as a substitute for checking.
