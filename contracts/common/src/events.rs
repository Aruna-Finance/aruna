use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub const STANDARD: &str = "aruna";
pub const VERSION: &str = "1.0.0";

/// NEP-297 event: `EVENT_JSON:{"standard":"aruna","version":"1.0.0","event":...,"data":[...]}`.
pub fn emit(event: &str, data: Value) {
    env::log_str(&format_event(event, data));
}

pub fn format_event(event: &str, data: Value) -> String {
    let body = json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] });
    format!("EVENT_JSON:{body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nep297_shape() {
        let line = format_event("agent_registered", json!({ "label": "bot" }));
        let body: Value = near_sdk::serde_json::from_str(line.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(body["standard"], "aruna");
        assert_eq!(body["version"], "1.0.0");
        assert_eq!(body["event"], "agent_registered");
        assert_eq!(body["data"][0]["label"], "bot");
    }
}
