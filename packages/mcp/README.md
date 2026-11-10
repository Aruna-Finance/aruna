# @aruna/mcp

An MCP server any agent can use to ask *"can this NEAR contract still change under me?"* before it
sends funds or calls. Keyless: no NEAR account, no key, no registration, no Aruna vault.

| Tool | Input | Returns |
|---|---|---|
| `aruna_check_target` | `account_id`, `network` (`mainnet` default, or `testnet`) | class, one-line reason, full evidence |
| `aruna_explain_class` | `class` | what the class means and what can still change |
| `aruna_read_vault` | `vault_id`, `network` (`testnet` default) | an Aruna vault's owner, operator, ceiling, each agent's policy, status, usage and real key permissions, what agents and the operator cannot do, and exposure per target |

A failed RPC read returns a tool error that says nothing was classified. It is never reported as
a class.

## Run it

```bash
pnpm install && pnpm -r build
node packages/mcp/dist/index.js        # stdio server
```

Add it to Claude Code:

```bash
claude mcp add aruna -- node "$(pwd)/packages/mcp/dist/index.js"
```

Then ask the agent: *"Use aruna_check_target on fx-guser.arunafi.testnet on testnet."* Expected:
`global_by_account`, with a reason saying `fx-gowner.arunafi.testnet` can redeploy the code and
`view_account.code_hash` will not change when it does.

Or: *"Use aruna_read_vault on demo2.factory.arunafi.testnet."* Expected: 0 full-access keys, agent
`honest` active with its spend today, agent `injected` paused and auto-disabled, and the exposure
to `swap.arunafi.testnet` recorded as `local_upgradeable`. A vault's state is public, so this needs
no key either; it reads and never spends.

`aruna_watch_target` (drift channels) is not in this server yet.

## Agent tools (optional, need an existing agent key)

```bash
ARUNA_AGENT_VAULT=demo2.factory.arunafi.testnet \
ARUNA_AGENT_KEY_FILE=~/.near-credentials/aruna-agents/demo2.factory.arunafi.testnet/honest.json \
node packages/mcp/dist/index.js
```

adds `aruna_spend`, `aruna_simulate` (vault v4), `aruna_budget` and `aruna_exposure` for that agent.
A policy refusal is a successful call with `verdict: "block"` and its reason, never an error; only
authorization and transport failures are. There is no coverage purchase: that is an owner action.
