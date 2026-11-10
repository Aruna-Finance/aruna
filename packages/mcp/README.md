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

`aruna_watch_target` (drift channels) arrives with the attestor, after v0. The tools that act for an
agent (`aruna_simulate`, `aruna_spend`) need an agent key and are not in v0.
