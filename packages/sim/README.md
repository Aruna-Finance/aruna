# @aruna/sim

Pool solvency simulation (docs/BUILD-PLAN.md stage 8): 200 agents over 60 days, five scenarios, and what the
simulation says about the two economic limits of the pool. Offline, seeded, deterministic, no runtime
dependencies.

**Nothing here is measured.** The chance that a contract changes (`P(event)`) is the pool's own declared
underwriting assumption (`contracts/common/src/params.rs`), and how often NEAR contracts really change is open
question 1 in `docs/DECISIONS.md`. The results are for testnet design. They gate nothing until release gate B.

## Run it

```bash
pnpm --filter @aruna/sim sim                 # about 3 minutes: 1,000 runs per scenario, 1,000 per derivation cell
pnpm --filter @aruna/sim sim --date 2026-11-12 --runs 200 --derive-runs 100   # a quick one
```

It writes `packages/sim/results/<date>/`:

| File | What |
|---|---|
| `assumptions.json` | every input of every scenario, and the pool's parameters |
| `raw/runs-<scenario>.jsonl` | one line per seeded run: the outputs |
| `raw/series-<scenario>.json` | the daily series of the run with the median ending capital |
| `raw/derivation.json` | every cell of the concentration and `k` sweeps |
| `summary.json`, `REPORT.md`, `charts/*.svg` | **built from `raw/` and `assumptions.json` alone** |

```bash
node packages/sim/dist/run.js --rebuild packages/sim/results/2026-11-12   # rebuild the three from raw/, no simulation
node packages/sim/dist/run.js --check   packages/sim/results/2026-11-12   # fail if any of them differs from what raw/ produces
```

The published run is [`results/2026-11-12/REPORT.md`](results/2026-11-12/REPORT.md). The console's simulation
screen should read `summary.json` there (plan U18) in place of its in-browser prototype.

## How it is held to the contract

`src/rules.ts` re-implements the pool's premium, capital adequacy, concentration, release, payout and withdrawal
lock in BigInt. `fixtures/golden/pool-rules.json` holds the answers of the **real** pool to 80 quotes, 9 purchase
and release sequences (including every boundary to the last yoctoNEAR) and 7 payout sequences. The pool's own
test regenerates it and fails if the file is stale (`ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden`
writes it); `test/golden.test.ts` replays it through the model. A rule change on either side fails one test. The
test also reads `params.rs` and fails if the model's constants differ from it. Five deliberate mutations of the
model (a boundary `>` made `>=`, partial payouts, concentration by hash only, rounding up, releasing before the
reporting period) each fail a golden test.

## What the model assumes

Everything except the pool's rules. The full list, with its kind (plan, modelling, underwriting assumption), is
in the report and in `assumptions.json`. Not modelled: who may buy (vault, policy, class record, attestor
heartbeat), disputes and the arbiter, a late or wrong attestor beyond a fixed delay, several underwriters or
tokens, and agents changing behaviour after a loss.

## Scenarios

`normal`, `single_target_changes`, `correlated_mass_claims`, `underwriter_withdrawal`, and
`insufficient_capital`, which breaks the pool and is shown as it happens. `underwriter_withdrawal_without_lock`
is a labelled counterfactual, not the contract.
