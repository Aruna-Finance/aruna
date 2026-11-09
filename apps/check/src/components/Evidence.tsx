import type { Classification, ClassEvidence } from "@/lib/classifier-types";
import { ZERO_HASH } from "@/lib/classifier-adapter";

const BASIS_TEXT: Record<ClassEvidence["mutabilityBasis"], string> = {
  no_detected_path: "By hash, no full-access key, none of the scanned imports.",
  full_access_key: "A full-access key exists. Its holder can change the code.",
  upgrade_imports:
    "No full-access key, but the code imports a scanned host function. It may have no reachable route.",
  own_code: "Local code, no full-access key, clean imports, not referenced by hash.",
  global_owner: "Another account owns the global contract and can redeploy it.",
  undetermined: "No code, or code that could not be fetched or parsed. Not determined.",
};

export function ClassResult({ c }: { c: Classification }) {
  const e = c.evidence;
  return (
    <div className="result">
      <p className={`cls cls-${c.class}`}>{c.class}</p>
      <p className="basis">
        <span className="mono">{e.mutabilityBasis}</span>: {BASIS_TEXT[e.mutabilityBasis]}
      </p>
      {c.class === "unknown" && (
        <p className="note">
          Unknown means not determined. It is not a safe verdict and is never priced.
        </p>
      )}
      {c.class === "immutable_verified" && (
        <p className="note">
          No detected upgrade path under the listed checks. This is not a claim that the contract
          is safe.
        </p>
      )}
      {c.class === "global_by_account" && (
        <table className="sbs" aria-label="Monitored field versus resolved code hash">
          <caption>The finding, side by side</caption>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">view_account.code_hash</td>
              <td className="mono">{ZERO_HASH}</td>
              <td className="bad">Wrong. Does not change when the owner redeploys.</td>
            </tr>
            <tr>
              <td className="mono">view_code.hash</td>
              <td className="mono">{e.resolvedCodeHash}</td>
              <td className="good">True. This is the code that runs.</td>
            </tr>
          </tbody>
        </table>
      )}
      <details open>
        <summary>Evidence</summary>
        <dl className="ev">
          <dt>account</dt>
          <dd className="mono">{e.accountId}</dd>
          <dt>code reference</dt>
          <dd className="mono">{e.codeRef ? JSON.stringify(e.codeRef) : "none"}</dd>
          <dt>full-access keys</dt>
          <dd className="mono">{e.fullAccessKeyCount}</dd>
          <dt>function-call keys</dt>
          <dd className="mono">{e.functionCallKeyCount} (recorded, does not affect the class)</dd>
          <dt>resolved code hash</dt>
          <dd className="mono">{e.resolvedCodeHash ?? "none"}</dd>
          <dt>scanned imports present</dt>
          <dd className="mono">{e.upgradeImports.length ? e.upgradeImports.join(", ") : "none"}</dd>
          <dt>WASM parsed</dt>
          <dd className="mono">{String(e.wasmParsed)}</dd>
        </dl>
      </details>
    </div>
  );
}
