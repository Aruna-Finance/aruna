//! Attestors (docs/ATTESTOR.md, plan R26): an account that posts a bond, a signing key kept separate
//! from the account so it can rotate without invalidating past reports (docs/DECISIONS.md D-30), and
//! a heartbeat anyone can read (D-29).

use crate::{Registry, RegistryExt};
use aruna_common::params::{ATTESTOR_MIN_BOND, HEARTBEAT_STALE_BLOCKS};
use aruna_common::emit;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, CurveType, PublicKey};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Attestor {
    /// ed25519 key that signs drift reports.
    pub signing_key: PublicKey,
    /// Locked bond, in yoctoNEAR. Zero after a slash: such an attestor cannot report.
    pub bond: U128,
    pub last_heartbeat: u64,
    pub registered_at: u64,
}

pub(crate) fn ed25519_bytes(key: &PublicKey) -> [u8; 32] {
    require!(key.curve_type() == CurveType::ED25519, "ARUNA_SIGNING_KEY_NOT_ED25519");
    key.as_bytes()[1..].try_into().unwrap_or_else(|_| env::panic_str("ARUNA_SIGNING_KEY_NOT_ED25519"))
}

#[near]
impl Registry {
    /// The caller becomes an attestor. Attach at least ATTESTOR_MIN_BOND; it is locked as the bond.
    #[payable]
    pub fn register_attestor(&mut self, signing_key: PublicKey) {
        ed25519_bytes(&signing_key);
        let who = env::predecessor_account_id();
        require!(!self.attestors.contains_key(&who), "ARUNA_ATTESTOR_EXISTS");
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond >= ATTESTOR_MIN_BOND, "ARUNA_BOND_TOO_SMALL");
        let now = env::block_height();
        emit("attestor_registered", json!({ "attestor": who, "signing_key": signing_key, "bond": U128(bond) }));
        self.attestors.insert(who, Attestor { signing_key, bond: U128(bond), last_heartbeat: now, registered_at: now });
    }

    /// Replace the signing key. Past reports stay valid; they were checked when filed.
    pub fn rotate_signing_key(&mut self, signing_key: PublicKey) {
        ed25519_bytes(&signing_key);
        let who = env::predecessor_account_id();
        let a = self.attestors.get_mut(&who).unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_ATTESTOR"));
        emit("attestor_key_rotated", json!({ "attestor": who, "before": a.signing_key, "after": signing_key }));
        a.signing_key = signing_key;
    }

    pub fn heartbeat(&mut self) {
        let who = env::predecessor_account_id();
        let a = self.attestors.get_mut(&who).unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_ATTESTOR"));
        a.last_heartbeat = env::block_height();
        emit("heartbeat", json!({ "attestor": who, "block": a.last_heartbeat }));
    }

    pub fn get_attestor(&self, attestor: AccountId) -> Option<Attestor> {
        self.attestors.get(&attestor).cloned()
    }

    pub fn assigned_attestor(&self, target: AccountId) -> Option<AccountId> {
        self.assignments.get(&target).cloned()
    }

    /// True when the target has an assigned attestor with a live bond whose last heartbeat is within
    /// HEARTBEAT_STALE_BLOCKS. The pool refuses new coverage otherwise (plan R12).
    pub fn heartbeat_fresh(&self, target: AccountId) -> bool {
        let Some(who) = self.assignments.get(&target) else { return false };
        let Some(a) = self.attestors.get(who) else { return false };
        a.bond.0 > 0 && env::block_height().saturating_sub(a.last_heartbeat) <= HEARTBEAT_STALE_BLOCKS
    }
}
