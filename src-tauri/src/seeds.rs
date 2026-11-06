use serde_json::Value;
use std::sync::OnceLock;

/// Initial values are shared with the TypeScript domain models.
pub fn data() -> &'static Value {
    static DEFAULTS: OnceLock<Value> = OnceLock::new();
    DEFAULTS.get_or_init(|| serde_json::from_str(include_str!("../../src/data/defaults.json"))
        .expect("invalid shared defaults"))
}
