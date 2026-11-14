# Security

## Status of this code

- **No independent third-party security audit has been done.** The only review is internal
  (`docs/AUDIT-v0.md`), written by the same people and tools that wrote the code. An external
  audit is a release gate, not a completed step (`docs/PRODUCT.md`).
- **Testnet only.** Every contract in this repository runs on NEAR testnet. **Nothing holds funds
  on mainnet.** The classifier reads mainnet state read-only.
- Known limits, including the ones found but not yet fixed, are listed in the README under
  "Limits". Read them before relying on anything here.

## Reporting a vulnerability

Report privately through this repository's GitHub security advisories:

**Security → Advisories → Report a vulnerability**

That keeps the report private until a fix exists. Please do not open a public issue for a
vulnerability, and please do not disclose it elsewhere first.

What helps: the contract or package affected, what an attacker gains, and the smallest
reproduction you have (a test, a transaction hash on testnet, or the exact view call).

We will acknowledge the report and tell you what we intend to do about it. Since the contracts are
immutable by design, a fix usually means a new contract version rather than a patch, so expect the
response to describe a migration (`docs/DECISIONS.md` D-65).

## Out of scope

- Anything requiring a key the attacker was given on purpose, such as an operator or agent key used
  within its stated permissions. What those keys can and cannot do is the point of the product, and
  is documented per role in `docs/CONTRACTS.md`.
- The two stated trust assumptions, the attestor and the arbiter. They are deliberate and disclosed
  in the README; an argument that they are the wrong design is welcome as an issue, not an advisory.
- Test fixtures and the `lab/` directory. The targets there are built to be broken on demand.
