# Raw input for the measurement

| Field | Value |
|---|---|
| File | `top-accounts-2026-10-09_2026-11-08.csv` |
| Source | `bigquery-public-data.crypto_near_mainnet_us.receipt_actions` |
| Query | `measurement/query.sql` |
| Parameters | `start_date=2026-10-09`, `end_date=2026-11-08` (30 complete days), `top_n=1000` |
| Rows | 1,000 accounts, ordered by function calls received, ties by account id |
| Bytes processed | 11,522,543,103 (dry run, 9 November 2026) |
| Exported | 2026-11-09T16:56Z |

Columns: `account_id` (the receipt receiver), `calls` (FUNCTION_CALL actions received in the
window), `distinct_signers`.

Re-running the query needs Google Cloud credentials and a billing project. Re-running the
classification from this file does not: `pnpm measure` reads it as committed.

The dataset's `action_kind` values on 1–9 November 2026 include `DEPLOY_GLOBAL_CONTRACT`,
`USE_GLOBAL_CONTRACT` and `USE_GLOBAL_CONTRACT_BY_ACCOUNT_ID`, so global-contract drift channels
can be counted from it. The action-kind list on the docs page predates them.
