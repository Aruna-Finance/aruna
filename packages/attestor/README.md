# @aruna/attestor

Watches the targets assigned to it, with the same engine as the classifier page, the CLI and the MCP
tool (`@aruna/classifier-core`), and files signed drift reports and heartbeats to the Aruna registry.
**Testnet only.**

The attestor is one of Aruna's two trust assumptions (the other is the arbiter). The registry checks
a report's signature, expiry, nonce, bond, that the two resolved code hashes differ, and that the
claimed `changed_at_block` lies within the lookback bound. It cannot check that the claimed block is
true (`docs/ATTESTOR.md`, `docs/DECISIONS.md` D-22, D-23).

## How it decides

- Each poll classifies each target and keeps the last observation in `~/.aruna-attestor/<account>.json`.
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

- Account key, for transactions: `~/.near-credentials/testnet/<account>.json` (near-cli-rs legacy keychain).
- Signing key, for reports: `~/.near-credentials/aruna-attestors/<account>.json`, created by `keygen`.
  Kept apart so it can rotate (`rotate_signing_key`) without invalidating past reports (D-30).

The signed bytes are fixed by `fixtures/golden/drift-report.json`, asserted here and in
`contracts/common`.

## Run

```bash
pnpm --filter @aruna/attestor build
node packages/attestor/dist/index.js keygen --attestor attestor-a.you.testnet
# register on the registry with the printed key and a 1 NEAR bond, then:
node packages/attestor/dist/index.js watch --attestor attestor-a.you.testnet --registry registry.cov.you.testnet --targets drift-target.you.testnet
```
