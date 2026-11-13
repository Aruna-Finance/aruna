# @aruna/keeper

After a drift report on a target is final, the keeper re-classifies the target's current code with the same engine as the
classifier page, the CLI and the MCP tool (`@aruna/classifier-core`), writes the class to the registry, and lifts the
target's freeze when the new class is no riskier than the recorded one. **Testnet only.**

It acts as the registry owner (`set_class` and `lift_freeze` are owner-only), so it is Aruna's own automation of that
authority, not a third party. It is a separate package from `@aruna/attestor` on purpose: an attestor run by someone else
must never carry this code or this key (release gate B).

## What it does, per target

A target is unhandled while its class record is older than its latest report. For an unhandled target:

| Latest report | New class against the recorded one | The keeper sends |
|---|---|---|
| Pending or Disputed | any | nothing |
| Verified or Rejected | same or safer | `lift_freeze`, then `set_class` |
| Verified or Rejected | riskier | `set_class` only; the freeze stays and the log says `HELD` |
| Verified or Rejected, target not frozen | any | `set_class` only |

Class order, least to most risky: `immutable_verified`, `local_upgradeable`, `global_by_account`, `unknown`
(`contracts/common/src/class.rs`). The lift comes before the write, so a run that stops between them leaves the record
older than the report and the next run finishes the write. The chain is the only memory: a handled target sends nothing.
A target held for being riskier is released by an operator with `lift_freeze` once its new code is reviewed.
The same goes for a target whose class someone wrote by hand with `set_class` after the report: the record is then newer than
the report, so the keeper counts it as handled and leaves the freeze for an operator.

## Pushing a freeze to the vaults

A report freezes its target in the registry at once, but a vault only learns of it through `push_freeze` (the registry
calls `freeze_target` on each listed vault) or when its cached class goes stale (`MAX_CLASS_AGE_BLOCKS`, 3600 blocks).
So for every target the registry holds frozen, the keeper reads each listed vault (`get_config` for the ceiling,
`get_class` for the cached copy) and, when one that allows the target still holds it open, sends `push_freeze` over the
whole vault list in batches of 20. Not in a run that has just lifted the freeze: that push would outlive the lift. The
chain is the memory again, since a pushed vault reads `frozen`; a vault that ignores the push is pushed at most once per
report while the process lives.

A pushed freeze stays in a vault's cache after `lift_freeze` until `refresh_class` pulls the registry again. The SDK's
`AgentVault.spend` does that on its own: on `TARGET_FROZEN` it reads the registry and, if the target is no longer frozen
there, refreshes and retries once (`docs/SDK.md`).

## Which targets it looks at

The targets the indexer has a report for (`--indexer-url` or `ARUNA_INDEXER_URL`) plus a seed list (`--targets` or
`ARUNA_KEEPER_TARGETS`) that covers a lagging indexer. The registry decides what is final; neither source can make the
keeper act on a target without a final report. When the indexer cannot be read, the seed list alone is used.

## Key

`ARUNA_KEEPER_KEY` (`ed25519:...`), else `~/.near-credentials/testnet/<account>.json`. On a host, use a function-call key on
the owner account limited to the registry and the methods `set_class`, `lift_freeze` and `push_freeze`; none takes a
deposit. A key without `push_freeze` still releases freezes; its push is refused by the network and logged each run. Even so,
the key can rewrite any target's class, so keep it as a secret and the full-access key off the host.

## Run

```bash
pnpm --filter @aruna/keeper build
node packages/keeper/dist/index.js run --account arunafi.testnet --registry registry2.arunafi.testnet \
  --indexer-url https://your-indexer.example --targets swap.arunafi.testnet,drift-target.arunafi.testnet
```

`--once` runs one pass and exits; otherwise it repeats every `--interval` seconds (default 60).
