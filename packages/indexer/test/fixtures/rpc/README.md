# Recorded RPC responses

`recorded.json` holds the real JSON-RPC responses `rpcSource` needs for the six fixture blocks of
`../blocks/`, plus a quiet block, recorded from a public testnet archive node on 11 November 2026.
Each key is `<method>|<params as JSON>`.

Ed25519 signatures in block headers and transactions are replaced with `ed25519:<signature omitted>`.
They are public chain data, but they look like secrets to `scripts/secret-scan.sh`, and the indexer
never reads them. Nothing else is edited.
