# MCP server — `@aruna/mcp`

A thin adapter over `@aruna/sdk`, so agents whose framework speaks tool-calling can use
Aruna without a custom integration. It should stay small enough to rewrite when tooling
conventions change.

**It is not an alternative to the SDK.** Read `SDK.md` first: the SDK is the durable
surface, this is one consumer of it. If a tool handler here grows logic that is not
presentation or argument shaping, that logic belongs in the SDK.

---

## Group A — keyless, works anywhere

No Aruna account, no vault, no key, no registration. Usable by any agent on NEAR,
including agents that will never touch our vault.

| Tool | Input | Returns |
|---|---|---|
| `aruna_check_target` | `account_id`, optional `network` | class, evidence, one-line reason |
| `aruna_watch_target` | `account_id` | resolved code hash now, state of all four drift channels, last observed change |
| `aruna_explain_class` | `class` | what the class means and what can still change |

`aruna_check_target` is the most valuable tool in the project. It answers *"can this
contract still change under me?"* for any NEAR account. Hash-based checks are blind to
`global_by_account`.

Keep these free of vault concepts. An agent using any other guard, or none, must be
able to call them.

## Group B — vault tools, need a registered agent key

| Tool | Input | Returns |
|---|---|---|
| `aruna_simulate` | action params | verdict `allow` or `block`, reason, target class, premium impact |
| `aruna_spend` | action params | execution result, or a refusal with its reason |
| `aruna_budget` | — | balance, spent today, reserved, remaining |
| `aruna_exposure` | — | exposure per target, each with its class |

One read in this group needs no key, because a vault's state is public: `aruna_read_vault`
(`vault_id`, optional `network`) returns the vault's owner, operator and ceiling, every agent with its
policy, status, usage and key permissions as the network enforces them, what agents and the operator
cannot do, and exposure per target. It is what `aruna_budget` and `aruna_exposure` will read for the
calling agent's own vault, available to anyone. Shipped in v0, over `@aruna/sdk` `readVault`.

**As built.** The four Group B tools are registered when the server is started with
`ARUNA_AGENT_VAULT` and `ARUNA_AGENT_KEY_FILE` (an existing agent key; the server creates none), over
`@aruna/sdk/vault`. `aruna_simulate` needs vault v4, whose `simulate` view runs the same `evaluate`
as `spend`. Its *premium impact* is not returned yet: it needs the coverage the agent holds, which
the pool does not index by agent.

`aruna_simulate` is a free view running the same checks without a transaction, so a
refusal costs no gas. **Its result is not binding** — state can change before the
transaction lands.

Two things it returns that the simulate calls of the five surveyed projects do not: the target's
current recorded **class**, and the **premium impact** of the action. That is the
policy-to-price chain surfaced at the moment of decision.

---

## Not in this server

- **Coverage purchase.** An owner action, done from the console with the owner's
  account. Never reachable by an agent key, in any layer.
- **Approval queues.** `aruna_simulate` has two verdicts, `allow` and `block`. There is
  no `needs_approval` — human approval queues are out of scope.
- **Receipts.** No module backs them; dropped until one exists.
- **Key management.** The server never creates accounts, adds keys or funds allowances.
- **Free-form `(target, method, args)`.** It would make the vault a generic proxy and
  destroy containment.
- **Automatic retry on a policy refusal.** A refusal means the agent must not do it.
  Stale-class refresh is different and is handled in the SDK, once.

## Errors

Mirror the SDK's split, do not flatten it. A policy refusal is a **successful tool call
returning `verdict: "block"`** with a reason. Only authorization and transport failures
are tool errors.

Flattening refusals into errors teaches agents to catch and ignore them, which defeats
the point of refusing.

---

## Examples to ship

Two runnable examples in `examples/`, neither requiring a paid API key.

**`examples/honest-agent.ts`** — a rule-based loop: fetch, decide, simulate, spend,
log refusals with their reason and the target's class.

**`examples/injected-agent.ts`** — the same loop with poisoned text injected into the
context it reads. It attempts a payout to an unlisted address and is refused twice:
once by the protocol, because the key cannot reach that contract, and once by the
vault, because no such action exists. Tune the auto-disable threshold so the run ends
with the agent disabled on screen.

The second example is the demo that makes the product legible in thirty seconds.
