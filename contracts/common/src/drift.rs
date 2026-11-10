//! Drift reports (docs/ATTESTOR.md "Report shape", plan R14) and the exact bytes an attestor signs
//! (plan KTD6). `fixtures/golden/drift-report.json` fixes those bytes for the Rust and TypeScript
//! sides; both test suites assert it.

use near_sdk::borsh::BorshSerialize;
use near_sdk::{near, AccountId};

/// What runs on the account, as the classifier reads it. For `GlobalAccount` the ref names only the
/// owner, which is why a report must also carry both resolved hashes.
#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodeRef {
    Local { code_hash: String },
    GlobalHash { global_hash: String },
    GlobalAccount { owner_account: AccountId },
}

/// Which change was observed (docs/DECISIONS.md D-13). The attestor infers it from state (plan KTD4).
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DriftChannel {
    ResolvedCode,
    DeployContract,
    UseGlobalContract,
    DeployGlobalContract,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DriftReport {
    pub target: AccountId,
    pub observed_at_block: u64,
    /// THE ATTESTOR'S CLAIM. Not verifiable on chain; only bounded by the lookback (D-23).
    pub changed_at_block: u64,
    pub before_ref: CodeRef,
    pub after_ref: CodeRef,
    pub before_resolved_hash: String,
    pub after_resolved_hash: String,
    pub channel: DriftChannel,
    pub attestor: AccountId,
    pub nonce: u64,
    /// Last block height at which the report may be submitted.
    pub expires_at: u64,
}

/// Domain separation, so a signature over a report can never be replayed as something else.
pub const SIGNING_PREFIX: &[u8] = b"aruna:drift-report:v1\n";

impl DriftReport {
    /// The bytes the attestor's key signs: the prefix, then the report's borsh encoding. Every field
    /// is covered, so a signature cannot be moved to a different target, ref, hash, nonce or expiry.
    pub fn signing_bytes(&self) -> Vec<u8> {
        let mut out = SIGNING_PREFIX.to_vec();
        self.serialize(&mut out).expect("borsh into a Vec cannot fail");
        out
    }
}

/// Lifecycle of an accepted report (plan, High-Level Technical Design).
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportState {
    Pending,
    Disputed,
    Verified,
    Rejected,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::{self, Value};

    fn golden() -> Value {
        serde_json::from_str(include_str!("../../../fixtures/golden/drift-report.json")).unwrap()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn signing_bytes_match_the_golden_vector() {
        let g = golden();
        let report: DriftReport = serde_json::from_value(g["report"].clone()).unwrap();
        assert_eq!(hex(&report.signing_bytes()), g["signing_bytes_hex"].as_str().unwrap());
    }

    #[test]
    fn every_field_changes_the_bytes() {
        let base: DriftReport = serde_json::from_value(golden()["report"].clone()).unwrap();
        let b = base.signing_bytes();
        let mut variants = vec![];
        let mut r = base.clone(); r.target = "other.testnet".parse().unwrap(); variants.push(r);
        let mut r = base.clone(); r.observed_at_block += 1; variants.push(r);
        let mut r = base.clone(); r.changed_at_block += 1; variants.push(r);
        let mut r = base.clone(); r.before_ref = CodeRef::Local { code_hash: "x".into() }; variants.push(r);
        let mut r = base.clone(); r.after_ref = CodeRef::GlobalHash { global_hash: "x".into() }; variants.push(r);
        let mut r = base.clone(); r.before_resolved_hash.push('x'); variants.push(r);
        let mut r = base.clone(); r.after_resolved_hash.push('x'); variants.push(r);
        let mut r = base.clone(); r.channel = DriftChannel::ResolvedCode; variants.push(r);
        let mut r = base.clone(); r.attestor = "a2.testnet".parse().unwrap(); variants.push(r);
        let mut r = base.clone(); r.nonce += 1; variants.push(r);
        let mut r = base.clone(); r.expires_at += 1; variants.push(r);
        for v in variants {
            assert_ne!(v.signing_bytes(), b, "{v:?}");
        }
    }

    #[test]
    fn the_golden_signature_verifies() {
        let g = golden();
        let report: DriftReport = serde_json::from_value(g["report"].clone()).unwrap();
        let unhex = |s: &str| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect::<Vec<u8>>();
        let sig: [u8; 64] = unhex(g["signature_hex"].as_str().unwrap()).try_into().unwrap();
        let pk: [u8; 32] = unhex(g["public_key_hex"].as_str().unwrap()).try_into().unwrap();
        assert!(near_sdk::env::ed25519_verify(&sig, report.signing_bytes(), &pk));
        let mut forged = report.clone();
        forged.nonce += 1;
        assert!(!near_sdk::env::ed25519_verify(&sig, forged.signing_bytes(), &pk));
    }
}
