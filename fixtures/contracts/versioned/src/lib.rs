//! versioned: one view method, `version()`, returning "v1" or (with `--features v2`) "v2".
//! No state, no promises, no imports beyond reading input and returning a value, so every fixture
//! account's class comes from how the code is referenced and which keys the account holds — never
//! from this code.
#![allow(clippy::missing_safety_doc)]

#[unsafe(no_mangle)]
pub extern "C" fn version() {
    let v: &[u8] = if cfg!(feature = "v2") { b"\"v2\"" } else { b"\"v1\"" };
    near_sdk::env::value_return(v);
}
