-- Top N mainnet accounts by function calls received, over a fixed block_date window.
-- Source: NEAR public dataset, docs.near.org/data-infrastructure/big-query.
-- The block_date filter bounds the partitions scanned, and so the cost.
-- Parameters: @start_date, @end_date (inclusive), @top_n.
SELECT
  receipt_receiver_account_id AS account_id,
  COUNT(*) AS calls,
  COUNT(DISTINCT signer_account_id) AS distinct_signers
FROM `bigquery-public-data.crypto_near_mainnet_us.receipt_actions`
WHERE block_date BETWEEN @start_date AND @end_date
  AND action_kind = 'FUNCTION_CALL'
GROUP BY account_id
ORDER BY calls DESC, account_id
LIMIT @top_n
