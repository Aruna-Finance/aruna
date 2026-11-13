# @aruna/attestor

Watches the targets assigned to it, with the same engine as the classifier page, the CLI and the MCP
tool (`@aruna/classifier-core`), and files signed drift reports and heartbeats to the Aruna registry.
**Testnet only.**

The attestor is one of Aruna's two trust assumptions (the other is the arbiter). The registry checks
a report's signature, expiry, nonce, bond, that the two resolved code hashes differ, and that the
claimed `changed_at_block` lies within the lookback bound. It cannot check that the claimed block is
true (`docs/ATTESTOR.md`, `docs/DECISIONS.md` D-22, D-23).

## What it watches

The targets the registry assigns to it (`assign_attestor`). The indexer lists them (`--indexer-url` or `ARUNA_INDEXER_URL`),
and `--targets` (or `ARUNA_ATTESTOR_TARGETS`) is a seed list that covers what a lagging indexer does not show yet. Every
candidate is confirmed with the registry's `assigned_attestor` before it is watched, so neither source alone can make the
attestor report on a target that is not assigned to it. The list is refreshed with each heartbeat, so a new assignment
needs no restart; when the indexer cannot be read, the last confirmed list (kept in the state file) and the seed list stay
in force. A target the registry assigns elsewhere is dropped and logged.

A heartbeat goes out every `--heartbeat-every` polls (default 18 polls of 10 s, about 3 minutes, a third of the registry's
600-block staleness bound). It does not depend on the target list.

## How it decides

- Each poll classifies each target and keeps the last observation in `<state dir>/<account>.json`
  (`ARUNA_ATTESTOR_STATE_DIR`, else `~/.aruna-attestor`). A lost observation makes the current code the new
  baseline, so a change made while the daemon was down is never reported: keep the state directory on a
  persistent volume.
- A change between two observations becomes a report. The channel is inferred from state, not from
  transactions: a changed local code hash is `deploy_contract`; a ref that moved is
  `use_global_contract`; an unchanged global-by-account ref whose executed code changed is
  `deploy_global_contract`; anything else is `resolved_code`.
- `changed_at_block` is the first block running the new code, found by bisecting historical
  `view_code` between the two observations. When the RPC cannot serve that history it is the block
  after the last unchanged observation. Neither counts exposure recorded after the change. Detection
  lag is the polling interval; a change older than the registry's lookback bound is refused, logged,
  and becomes the new baseline.
- A failed RPC read observes nothing and reports nothing.

## Keys

Each key is read from the environment first, then from a file. The environment is for a host with no home
directory to keep files in, such as a container; set the values as the host's secrets, never in the repo.

| Key | Signs | Environment | File |
|---|---|---|---|
| Account key | transactions (`heartbeat`, `report_drift`) | `ARUNA_ATTESTOR_ACCOUNT_KEY` (`ed25519:...`) | `~/.near-credentials/testnet/<account>.json` |
| Signing key | the bytes of each report | `ARUNA_ATTESTOR_SIGNING_SEED_HEX` (64 hex characters) | `~/.near-credentials/aruna-attestors/<account>.json`, field `seed_hex` |

- The two are kept apart so the signing key can rotate (`rotate_signing_key`) without invalidating past
  reports (D-30).
- Only `keygen` creates a signing key, and never when `ARUNA_ATTESTOR_SIGNING_SEED_HEX` is set. Every other
  command stops if it finds none.
- At start, `watch`, `heartbeat` and `dispute` compare the public key of the signing seed with the one the
  registry holds (`get_attestor`) and stop if they differ or the account is not registered.
- On a host, use a function-call key as the account key, limited to the registry and to `heartbeat` and
  `report_drift`. Neither method takes a deposit, so the key works, and a leaked one cannot move the account's
  funds or change its keys. Keep the full-access key off the host.
- A failed heartbeat is logged and retried at the next poll; the daemon keeps running.

The signed bytes are fixed by `fixtures/golden/drift-report.json`, asserted here and in
`contracts/common`.

## Run

```bash
pnpm --filter @aruna/attestor build
node packages/attestor/dist/index.js keygen --attestor attestor-a.you.testnet
# register on the registry with the printed key and a 1 NEAR bond, then:
node packages/attestor/dist/index.js watch --attestor attestor-a.you.testnet --registry registry.cov.you.testnet --targets drift-target.you.testnet
# or follow the registry's assignments, with the indexer's list as the source:
node packages/attestor/dist/index.js watch --attestor attestor-a.you.testnet --registry registry.cov.you.testnet --indexer-url https://your-indexer.example
```
