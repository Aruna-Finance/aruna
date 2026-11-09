// The host functions whose presence means an upgrade path cannot be ruled out (docs/CLASSIFIER.md step 3).
// A contract cannot call a host function it does not import, so their absence is sound.
// Matched by function name in any import module: the conservative reading.
// Changing this list changes classifications: record the change in docs/DECISIONS.md first.

export const SCANNED_IMPORTS: readonly string[] = [
  "promise_batch_action_deploy_contract",
  "promise_batch_action_use_global_contract",
  "promise_batch_action_use_global_contract_by_account_id",
  "promise_batch_action_add_key_with_full_access",
  "promise_batch_action_add_gas_key_with_full_access",
  "promise_batch_action_delete_account",
];

/**
 * Named in docs/CLASSIFIER.md as "still to review". Not scanned in v0, so they never change a class.
 * They are listed here so the open question has one owner.
 */
export const REVIEW_PENDING_IMPORTS: readonly string[] = [
  "promise_batch_action_deploy_global_contract_by_account_id",
  "promise_batch_action_state_init",
  "promise_batch_action_state_init_by_account_id",
  "promise_batch_action_universal_state_init",
];
