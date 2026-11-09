use near_sdk::near;

/// The four classes of docs/CLASSIFIER.md, ordered from least to most risky, so that
/// `class <= policy.max_risk_class` is the policy check.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskClass {
    ImmutableVerified,
    LocalUpgradeable,
    GlobalByAccount,
    Unknown,
}

impl RiskClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            RiskClass::ImmutableVerified => "immutable_verified",
            RiskClass::LocalUpgradeable => "local_upgradeable",
            RiskClass::GlobalByAccount => "global_by_account",
            RiskClass::Unknown => "unknown",
        }
    }

    /// Auto-disable weight of a refusal against a target of this class (docs/CONTRACTS.md).
    pub const fn refusal_weight(self) -> u32 {
        match self {
            RiskClass::ImmutableVerified => 1,
            RiskClass::LocalUpgradeable => 2,
            RiskClass::GlobalByAccount => 4,
            RiskClass::Unknown => 8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RiskClass::*;

    #[test]
    fn ordered_by_risk() {
        assert!(ImmutableVerified < LocalUpgradeable);
        assert!(LocalUpgradeable < GlobalByAccount);
        assert!(GlobalByAccount < Unknown);
    }

    #[test]
    fn json_names_match_the_classifier() {
        for (c, s) in [
            (ImmutableVerified, "immutable_verified"),
            (LocalUpgradeable, "local_upgradeable"),
            (GlobalByAccount, "global_by_account"),
            (Unknown, "unknown"),
        ] {
            assert_eq!(near_sdk::serde_json::to_string(&c).unwrap(), format!("\"{s}\""));
            assert_eq!(c.as_str(), s);
        }
    }
}
