# SDK — `@aruna/sdk`

The compatibility contract for everyone outside this repo, and the layer every other
surface is written against: MCP, the console, the attestor, the CLI.

MCP is **not** an alternative to this. The MCP server is a thin adapter over the SDK.
An agent has a half that decides (a model, speaking tool calls) and a half that
executes (ordinary code); MCP serves the first, this serves the second.

---

## Packages below it

| Package | Role |
|---|---|
| `@aruna/classifier-core` | Pure. Account id + `RpcReader` → class + evidence. **Zero dependencies** |
| `@aruna/rpc` | `RpcReader` implementations and a small JSON-RPC client |

The SDK composes both and adds signing, contract typing, error mapping and staleness
handling. Anything that only needs classification should depend on `classifier-core`
directly — it is publishable on its own and useful to people who never touch a vault.

---

## Surface

Four clients, separable so a consumer imports only what it needs.

```ts
import { Classifier, Vault, Registry, Pool } from "@aruna/sdk";
```

### `Classifier` — keyless

```ts
const c = new Classifier({ network: "testnet" });

await c.check("some.contract.near");
// → { class, evidence, reason }

await c.watch("some.contract.near");
// → { resolvedCodeHash, channels: { ... }, lastChange }
```

No account, no key, no registration. This is the surface most third parties will use,
and the one that must stay stable longest.

### `Vault` — needs an agent key, the operator or the owner

```ts
const vault = new Vault({ vaultId, signer, network: "testnet" });

// agent actions
await vault.simulate(action);     // free view, non-binding
await vault.spend(action);
await vault.budget();
await vault.exposure();
await vault.refreshClass(target);        // callable by anyone; pulls from the registry

// operator actions: only within the owner's ceiling, and tightening only
await vault.createAgent({ label, policy });
await vault.tightenPolicy(publicKey, policy);
await vault.pauseAgent(publicKey);
await vault.revokeAgent(publicKey);      // delete_key — network-level

// owner actions
await vault.setCeiling(ceiling);
await vault.setOperator(accountId);      // or null
await vault.updatePolicy(publicKey, policy);
await vault.resumeAgent(publicKey);
await vault.withdrawToOwner(amount);
```

Agent, operator and owner methods are separated in the types. An agent key physically cannot
reach owner methods, and the SDK should not pretend otherwise by exposing them on the
same client instance.

### `Registry` and `Pool`

```ts
await registry.classOf(target);
await registry.driftReports({ target, since });
await registry.vaultVersion(vaultId);

await pool.quote({ target, limit, days });
await pool.buyCoverage({ target, limit, days });   // OWNER action, never an agent key
await pool.positions();
await pool.concentration();
```

Coverage purchase is an owner action. Do not expose it to agent keys anywhere, in any
layer.

---

## Error model

The contracts split failures two ways (`CONTRACTS.md`), and the SDK must mirror that
split rather than flattening it.

| Contract behaviour | SDK behaviour |
|---|---|
| Policy refusal → returns `Blocked{reason}` | **Resolves** with `{ ok: false, reason, targetClass }` |
| Authorization failure → panics | **Throws** `ArunaAuthError` |
| Network or RPC failure | **Throws** `ArunaRpcError` |

A refusal is the product working. Making callers write `try/catch` around normal
operation is a design error, and it leads integrators to swallow real failures.

```ts
const r = await vault.spend(action);
if (!r.ok) {
  // r.reason: DAILY_CAP_EXCEEDED | MAX_PER_TX_EXCEEDED | TARGET_NOT_ALLOWED
  //         | TARGET_FROZEN | RISK_CLASS_NOT_ALLOWED | CLASS_STALE
  //         | SLIPPAGE_TOO_HIGH | AGENT_NOT_ACTIVE | AGENT_AUTO_DISABLED
  //         | INSUFFICIENT_BALANCE
}
```

Reason codes map one-to-one to the contract's `ARUNA_*` values. A test asserts the two
sets are identical; let them drift and every integrator's error handling rots.

In v0: `REASONS`, `AUTO_DISABLE_REASONS` and `parseReason("ARUNA_…")` (which throws on a value it
does not know) are exported. `packages/sdk/test/reasons.test.ts` checks both lists against
`contracts/common/src/reasons.rs` and the table in `CONTRACTS.md`.

## Staleness is handled here, not by the caller

The vault refuses a spend when its cached class is older than the bound. The SDK
absorbs that:

```ts
// default behaviour
await vault.spend(action);
// → sees CLASS_STALE, calls refreshClass(target), retries once, returns the result
```

Expose `{ autoRefresh: false }` for callers who want to see it. One retry only; never
loop.

## Type generation

`cargo near build` emits an ABI. TypeScript types are generated from it as a build
step.

This is not a convenience. Without it the SDK and the contracts drift silently and the
first symptom is a failed transaction on testnet. With it, a changed contract signature
breaks the SDK build — which is the correct moment to find out.

## Versioning

Semver, and it is a real commitment once anyone depends on it.

- `classifier-core` and the `Classifier` client change most slowly; treat their shapes
  as public API from day one.
- Contract-facing clients move with contract versions. The SDK carries a supported
  range and refuses a vault whose code hash it does not recognise, with a clear message
  rather than a confusing failure.
- Because vaults are immutable, several versions run in production simultaneously.
  **The SDK must support more than one vault version at a time.** Plan for it now; it
  is not an edge case, it is the normal state.

---

## Integration example

What an agent developer actually writes. Keep it this small.

```ts
import { Vault } from "@aruna/sdk";

const vault = new Vault({
  vaultId: "vault-budi.aruna.testnet",
  signer: agentKeyPair,
  network: "testnet",
});

while (true) {
  const market = await fetchPrices();
  const decision = decide(market);

  if (decision.action === "swap") {
    const r = await vault.spend({
      adapter: "dex",
      tokenIn: "usdc.testnet",
      amountIn: "50",
      minAmountOut: computeMin(market),
    });
    if (!r.ok) log.warn("refused", r.reason, r.targetClass);
  }

  await sleep(300_000);
}
```

If integrating requires the developer to understand the gate, reservation accounting or
risk classes, the surface has failed.

## What must never be here

- A method taking a free-form `(target, method, args)`. It would make the vault a
  generic proxy and destroy containment.
- Account creation or key generation. Those are the console and CLI. `createAgent` takes a
  public key the caller already generated.
- Automatic retry on a policy refusal. A refusal means the agent must not do it.
  Retrying a stale class is different and is allowed, once.
- Silent fallbacks when a vault version is unsupported. Fail loudly.
