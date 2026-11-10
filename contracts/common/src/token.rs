use near_sdk::{near, AccountId};

/// The token an amount is denominated in (docs/plans/2026-11-10-2106-feat-coverage-loop-testnet-plan.md
/// R1): NEAR itself, or a NEP-141 fungible token contract. Coverage, premiums, capital, payouts and
/// exposure are always in one token; nothing converts between them.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TokenId {
    Near,
    Ft(AccountId),
}

impl TokenId {
    /// A short, stable key for storage maps and events: `near`, or the token contract's account id.
    pub fn key(&self) -> String {
        match self {
            TokenId::Near => "near".to_string(),
            TokenId::Ft(a) => a.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json;

    #[test]
    fn json_shape() {
        assert_eq!(serde_json::to_string(&TokenId::Near).unwrap(), "\"near\"");
        let ft = TokenId::Ft("usdc.testnet".parse().unwrap());
        assert_eq!(serde_json::to_string(&ft).unwrap(), "{\"ft\":\"usdc.testnet\"}");
        assert_eq!(serde_json::from_str::<TokenId>("{\"ft\":\"usdc.testnet\"}").unwrap(), ft);
        assert_eq!(ft.key(), "usdc.testnet");
        assert_eq!(TokenId::Near.key(), "near");
    }
}
