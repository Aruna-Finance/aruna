use near_sdk::near;

/// Canonical refusal reasons (docs/CONTRACTS.md). The SDK uses the same names without `ARUNA_`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    #[serde(rename = "ARUNA_TARGET_NOT_ALLOWED")]
    TargetNotAllowed,
    #[serde(rename = "ARUNA_MAX_PER_TX_EXCEEDED")]
    MaxPerTxExceeded,
    #[serde(rename = "ARUNA_DAILY_CAP_EXCEEDED")]
    DailyCapExceeded,
    #[serde(rename = "ARUNA_SLIPPAGE_TOO_HIGH")]
    SlippageTooHigh,
    #[serde(rename = "ARUNA_RISK_CLASS_NOT_ALLOWED")]
    RiskClassNotAllowed,
    #[serde(rename = "ARUNA_TARGET_FROZEN")]
    TargetFrozen,
    #[serde(rename = "ARUNA_CLASS_STALE")]
    ClassStale,
    #[serde(rename = "ARUNA_INSUFFICIENT_BALANCE")]
    InsufficientBalance,
    #[serde(rename = "ARUNA_AGENT_NOT_ACTIVE")]
    AgentNotActive,
    #[serde(rename = "ARUNA_AGENT_AUTO_DISABLED")]
    AgentAutoDisabled,
}

impl Reason {
    pub const ALL: [Reason; 10] = [
        Reason::TargetNotAllowed,
        Reason::MaxPerTxExceeded,
        Reason::DailyCapExceeded,
        Reason::SlippageTooHigh,
        Reason::RiskClassNotAllowed,
        Reason::TargetFrozen,
        Reason::ClassStale,
        Reason::InsufficientBalance,
        Reason::AgentNotActive,
        Reason::AgentAutoDisabled,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Reason::TargetNotAllowed => "ARUNA_TARGET_NOT_ALLOWED",
            Reason::MaxPerTxExceeded => "ARUNA_MAX_PER_TX_EXCEEDED",
            Reason::DailyCapExceeded => "ARUNA_DAILY_CAP_EXCEEDED",
            Reason::SlippageTooHigh => "ARUNA_SLIPPAGE_TOO_HIGH",
            Reason::RiskClassNotAllowed => "ARUNA_RISK_CLASS_NOT_ALLOWED",
            Reason::TargetFrozen => "ARUNA_TARGET_FROZEN",
            Reason::ClassStale => "ARUNA_CLASS_STALE",
            Reason::InsufficientBalance => "ARUNA_INSUFFICIENT_BALANCE",
            Reason::AgentNotActive => "ARUNA_AGENT_NOT_ACTIVE",
            Reason::AgentAutoDisabled => "ARUNA_AGENT_AUTO_DISABLED",
        }
    }

    /// Only agent-caused refusals count toward auto-disable (docs/DECISIONS.md D-19).
    pub const fn counts_toward_auto_disable(self) -> bool {
        matches!(
            self,
            Reason::TargetNotAllowed | Reason::MaxPerTxExceeded | Reason::DailyCapExceeded | Reason::SlippageTooHigh
        )
    }
}

/// Authorization failures panic with these (docs/CONTRACTS.md error model). Nothing persists.
pub mod panics {
    pub const NOT_OWNER: &str = "ARUNA_NOT_OWNER";
    pub const NOT_OWNER_OR_OPERATOR: &str = "ARUNA_NOT_OWNER_OR_OPERATOR";
    pub const NOT_CLASSIFIER: &str = "ARUNA_NOT_AUTHORIZED_CLASSIFIER";
    pub const NOT_FACTORY: &str = "ARUNA_NOT_FACTORY";
    pub const UNKNOWN_AGENT: &str = "ARUNA_UNKNOWN_AGENT";
    pub const AGENT_EXISTS: &str = "ARUNA_AGENT_EXISTS";
    pub const OVER_CEILING: &str = "ARUNA_OVER_CEILING";
    pub const OPERATOR_CANNOT_LOOSEN: &str = "ARUNA_OPERATOR_CANNOT_LOOSEN";
    pub const OPERATOR_CANNOT_RESUME: &str = "ARUNA_OPERATOR_CANNOT_RESUME";
    pub const REVOKED: &str = "ARUNA_AGENT_REVOKED";
    pub const BAD_METHOD_NAME: &str = "ARUNA_CALLBACK_IN_AGENT_KEY";
}

#[cfg(test)]
mod tests {
    use super::Reason;

    #[test]
    fn json_is_the_canonical_name() {
        for r in Reason::ALL {
            assert_eq!(near_sdk::serde_json::to_string(&r).unwrap(), format!("\"{}\"", r.as_str()));
        }
    }

    #[test]
    fn exactly_the_four_agent_caused_reasons_count() {
        let counted: Vec<&str> = Reason::ALL.iter().filter(|r| r.counts_toward_auto_disable()).map(|r| r.as_str()).collect();
        assert_eq!(
            counted,
            ["ARUNA_TARGET_NOT_ALLOWED", "ARUNA_MAX_PER_TX_EXCEEDED", "ARUNA_DAILY_CAP_EXCEEDED", "ARUNA_SLIPPAGE_TOO_HIGH"]
        );
    }
}
