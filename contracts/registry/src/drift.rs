//! The drift path (docs/ATTESTOR.md "Lifecycle", plan R14–R20). What the contract can enforce: the
//! signature, expiry, nonce, the attestor's bond, the two resolved hashes differing, and the lookback
//! bound on `changed_at_block` (docs/DECISIONS.md D-23). What it cannot: whether the claimed block is
//! true. That is the attestor trust assumption; disputes go to the arbiter, the second one.

use crate::attestors::ed25519_bytes;
use crate::{ClassRecord, Registry, RegistryExt};
use aruna_common::params::{CHALLENGE_WINDOW_BLOCKS, MAX_LOOKBACK_BLOCKS};
use aruna_common::{emit, DriftReport, ReportState, RiskClass};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

const GAS_FREEZE: Gas = Gas::from_tgas(5);
const GAS_SLASH: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StoredReport {
    pub id: u32,
    pub report: DriftReport,
    pub reported_at_block: u64,
    /// Pending, Disputed, or a ruling; `get_report` turns a Pending report whose window has closed into
    /// Verified without a transaction.
    pub state: ReportState,
    /// The other report in a dispute, if any.
    pub disputed_by: Option<u32>,
}

impl Registry {
    fn effective_state(&self, r: &StoredReport) -> ReportState {
        match r.state {
            ReportState::Pending if env::block_height() >= r.reported_at_block + CHALLENGE_WINDOW_BLOCKS => ReportState::Verified,
            s => s,
        }
    }

    fn set_frozen(&mut self, target: &AccountId, frozen: bool) {
        let now = env::block_height();
        let mut rec = self.classes.get(target).cloned().unwrap_or(ClassRecord {
            class: RiskClass::Unknown,
            evidence_hash: String::new(),
            classified_at_block: now,
            classifier: env::current_account_id(),
            frozen,
            resolved_code_hash: None,
            upgrade_authority: None,
        });
        rec.frozen = frozen;
        self.classes.insert(target.clone(), rec);
    }

    fn report_mut(&mut self, id: u32) -> &mut StoredReport {
        self.reports.get_mut(id).unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_REPORT"))
    }
}

#[near]
impl Registry {
    /// Filed by the attestor's account, signed by its separate signing key over every report field.
    /// Accepting it freezes the target at once, before the challenge window closes (plan R16).
    /// Returns the report id.
    pub fn report_drift(&mut self, report: DriftReport, signature: Base64VecU8) -> u32 {
        let now = env::block_height();
        let who = env::predecessor_account_id();
        require!(report.attestor == who, "ARUNA_NOT_REPORT_ATTESTOR");
        let a = self.attestors.get(&who).cloned().unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_ATTESTOR"));
        require!(a.bond.0 > 0, "ARUNA_NO_BOND");
        let sig: [u8; 64] = signature.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("ARUNA_BAD_SIGNATURE"));
        require!(env::ed25519_verify(&sig, report.signing_bytes(), &ed25519_bytes(&a.signing_key)), "ARUNA_BAD_SIGNATURE");
        require!(now <= report.expires_at, "ARUNA_REPORT_EXPIRED");
        require!(!self.used_nonces.contains(&(who.clone(), report.nonce)), "ARUNA_NONCE_REUSED");
        require!(report.before_resolved_hash != report.after_resolved_hash, "ARUNA_HASHES_MATCH");
        require!(report.changed_at_block <= report.observed_at_block && report.observed_at_block <= now, "ARUNA_BAD_BLOCKS");
        require!(report.changed_at_block >= now.saturating_sub(MAX_LOOKBACK_BLOCKS), "ARUNA_OUTSIDE_LOOKBACK");

        let id = self.reports.len();
        let mut state = ReportState::Pending;
        let mut disputed_by = None;
        if let Some(prev_id) = self.latest_report.get(&report.target).copied() {
            let prev = self.reports.get(prev_id).cloned().unwrap();
            let open = self.effective_state(&prev) == ReportState::Pending;
            if open && prev.report.attestor == who {
                env::panic_str("ARUNA_REPORT_ALREADY_OPEN");
            }
            let conflicts = prev.report.changed_at_block != report.changed_at_block || prev.report.after_resolved_hash != report.after_resolved_hash;
            if open && conflicts {
                state = ReportState::Disputed;
                disputed_by = Some(prev_id);
                let p = self.report_mut(prev_id);
                p.state = ReportState::Disputed;
                p.disputed_by = Some(id);
                emit("report_disputed", json!({ "report": prev_id, "by": id, "target": report.target }));
            }
        }
        self.used_nonces.insert((who.clone(), report.nonce));
        self.latest_report.insert(report.target.clone(), id);
        self.set_frozen(&report.target, true);
        emit("drift_reported", json!({ "id": id, "report": report, "reported_at_block": now, "state": state }));
        self.reports.push(StoredReport { id, report, reported_at_block: now, state, disputed_by });
        id
    }

    /// Pushes a frozen target's freeze to registered vaults `[from, from + limit)`. Anyone may call it;
    /// one transaction's gas limits the batch (plan KTD8). A vault outside the batch learns of the
    /// freeze at its next `refresh_class`. Returns how many vaults were called.
    pub fn push_freeze(&mut self, target: AccountId, from: u32, limit: u32) -> u32 {
        require!(self.classes.get(&target).is_some_and(|r| r.frozen), "ARUNA_TARGET_NOT_FROZEN");
        let end = from.saturating_add(limit).min(self.vault_list.len());
        let args = json!({ "target": target }).to_string().into_bytes();
        for i in from..end {
            let vault = self.vault_list.get(i).cloned().unwrap();
            Promise::new(vault).function_call("freeze_target".to_string(), args.clone(), NearToken::from_yoctonear(0), GAS_FREEZE).detach();
        }
        emit("freeze_pushed", json!({ "target": target, "from": from, "to": end }));
        end.saturating_sub(from)
    }

    /// Arbiter only, on a Disputed report. Upheld: the report is Verified and its claims may proceed.
    /// Rejected: the report is Rejected, the target unfrozen, and the reporting attestor's bond sent to
    /// the pool's NEAR book (plan KTD9).
    pub fn rule(&mut self, report_id: u32, upheld: bool) {
        require!(env::predecessor_account_id() == self.arbiter, "ARUNA_NOT_ARBITER");
        let r = self.reports.get(report_id).cloned().unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_REPORT"));
        require!(r.state == ReportState::Disputed, "ARUNA_NOT_DISPUTED");
        if upheld {
            self.report_mut(report_id).state = ReportState::Verified;
            emit("report_ruled", json!({ "report": report_id, "upheld": true }));
            return;
        }
        self.report_mut(report_id).state = ReportState::Rejected;
        self.set_frozen(&r.report.target, false);
        let attestor = r.report.attestor.clone();
        let a = self.attestors.get_mut(&attestor).unwrap();
        let bond = a.bond.0;
        a.bond = U128(0);
        emit("report_ruled", json!({ "report": report_id, "upheld": false, "slashed": U128(bond), "attestor": attestor }));
        if bond > 0 {
            let pool = self.pool.clone().unwrap_or_else(|| env::panic_str("ARUNA_NO_POOL"));
            Promise::new(pool).function_call("receive_slash".to_string(), json!({ "attestor": attestor }).to_string().into_bytes(), NearToken::from_yoctonear(bond), GAS_SLASH).detach();
        }
    }

    /// Owner only. Lifts a freeze once the target's latest report is final (Verified or Rejected),
    /// typically after the target's new code has been classified again. Never while a report is
    /// Pending or Disputed. Claims are unaffected: they read the report's state, not this flag.
    /// Vaults lift their cached freeze at their next `refresh_class`.
    pub fn lift_freeze(&mut self, target: AccountId) {
        require!(env::predecessor_account_id() == self.owner, aruna_common::reasons::panics::NOT_OWNER);
        if let Some(r) = self.latest_report(target.clone()) {
            require!(matches!(r.state, ReportState::Verified | ReportState::Rejected), "ARUNA_REPORT_NOT_FINAL");
        }
        self.set_frozen(&target, false);
        emit("freeze_lifted", json!({ "target": target }));
    }

    /// A report with its state as of now.
    pub fn get_report(&self, id: u32) -> Option<StoredReport> {
        self.reports.get(id).map(|r| StoredReport { state: self.effective_state(r), ..r.clone() })
    }

    pub fn latest_report(&self, target: AccountId) -> Option<StoredReport> {
        self.latest_report.get(&target).and_then(|id| self.get_report(*id))
    }
}
