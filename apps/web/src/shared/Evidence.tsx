import type { Classification, ClassEvidence } from "@/landing/lib/classifier-types";
import { Disclosure } from "@/shared/Disclosure";
import { ZERO_HASH } from "@/landing/lib/classifier-adapter";

const BASIS_TEXT: Record<ClassEvidence["mutabilityBasis"], string> = {
  no_detected_path: "By hash, no full-access key, none of the scanned imports.",
  full_access_key: "A full-access key exists. Its holder can change the code.",
  upgrade_imports:
    "No full-access key, but the code imports a scanned host function. It may have no reachable route.",
  own_code: "Local code, no full-access key, clean imports, not referenced by hash.",
  global_owner: "Another account owns the global contract and can redeploy it.",
  undetermined: "No code, or code that could not be fetched or parsed. Not determined.",
};

const CLS_STYLE: Record<Classification["class"], string> = {
  immutable_verified: "",
  local_upgradeable: "",
  global_by_account: "text-dawn-ink",
  unknown: "border-l-[3px] border-dashed border-muted pl-2.5 text-muted",
};

const note = "mt-3 max-w-[62ch] bg-dawn-wash px-3 py-2 text-sm";
const cell = "border border-line p-2 text-left align-top";

function codeSource(r: ClassEvidence["codeRef"]): string {
  if (!r) return "none";
  if (r.kind === "local") return "local code";
  if (r.kind === "global_hash") return "global, pinned by hash";
  return `global, by account (owner ${r.ownerAccount})`;
}

function rows(e: ClassEvidence) {
  return [
    {
      label: "Account",
      from: "your input",
      value: e.accountId,
      meaning: "The account we classified.",
    },
    {
      label: "Where the code comes from",
      from: "view_account",
      value: codeSource(e.codeRef),
      meaning:
        "Local code sits on this account. Global code is shared: pinned by hash it never changes, referenced by account its owner can swap it.",
    },
    {
      label: "Full-access keys",
      from: "view_access_key_list",
      value: String(e.fullAccessKeyCount),
      meaning:
        e.fullAccessKeyCount > 0
          ? "A full-access key lets its holder redeploy the code. This is what makes a contract upgradeable."
          : "None found. No key can redeploy the code directly.",
    },
    {
      label: "Function-call keys",
      from: "view_access_key_list",
      value: String(e.functionCallKeyCount),
      meaning: "Limited keys that can only call listed methods. Recorded, but they do not change the class.",
    },
    {
      label: "Code that actually runs",
      from: "view_code",
      value: e.resolvedCodeHash ?? "none",
      meaning:
        "The hash of the code currently executing. For global-by-account this differs from the hash view_account reports.",
    },
    {
      label: "Upgrade imports found",
      from: "view_code",
      value: e.upgradeImports.length ? e.upgradeImports.join(", ") : "none",
      meaning:
        "Host functions in the code that could deploy or replace code. A hit means a path may exist, not that one is reachable.",
    },
    {
      label: "Code could be read",
      from: "view_code",
      value: e.wasmParsed ? "yes" : "no",
      meaning: e.wasmParsed
        ? "The code was fetched and parsed, so the import scan ran."
        : "The code was missing or unreadable, so nothing could be scanned. The result stays unknown.",
    },
  ];
}

export function ClassResult({ c }: { c: Classification }) {
  const e = c.evidence;
  return (
    <div>
      <p className={`mt-4 mb-1 font-mono text-[22px] font-medium ${CLS_STYLE[c.class]}`}>{c.class}</p>
      <p className="max-w-[62ch]">
        <span className="mono">{e.mutabilityBasis}</span>: {BASIS_TEXT[e.mutabilityBasis]}
      </p>
      {c.class === "unknown" && (
        <p className={note}>Unknown means not determined. It is not a safe verdict and is never priced.</p>
      )}
      {c.class === "immutable_verified" && (
        <p className={note}>
          No detected upgrade path under the listed checks. This is not a claim that the contract is safe.
        </p>
      )}
      {c.class === "global_by_account" && (
        <table className="my-4 w-full border-collapse text-sm" aria-label="Monitored field versus resolved code hash">
          <caption className="mb-1.5 text-left font-semibold">The finding, side by side</caption>
          <thead>
            <tr>
              <th className={cell}>Field</th>
              <th className={cell}>Value</th>
              <th className={cell}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${cell} mono`}>view_account.code_hash</td>
              <td className={`${cell} mono`}>{e.monitoredCodeHash ?? ZERO_HASH}</td>
              <td className={`${cell} text-dawn-ink`}>Wrong. Does not change when the owner redeploys.</td>
            </tr>
            <tr>
              <td className={`${cell} mono`}>view_code.hash</td>
              <td className={`${cell} mono`}>{e.resolvedCodeHash}</td>
              <td className={`${cell} font-medium`}>True. This is the code that runs.</td>
            </tr>
          </tbody>
        </table>
      )}
      <Disclosure title="Evidence" open className="mt-4">
        <p className="mt-2 max-w-[62ch] text-sm text-muted">
          What we read from the chain, and what each item means for the class above.
        </p>
        <dl className="mt-3 border-t border-line-2">
          {rows(e).map((r) => (
            <div key={r.label} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[200px_1fr] sm:gap-6">
              <dt>
                <span className="font-medium">{r.label}</span>
                <span className="label mt-0.5 block text-[11px] text-muted">{r.from}</span>
              </dt>
              <dd>
                <span className="mono block">{r.value}</span>
                <span className="mt-1 block max-w-[62ch] text-sm text-slate">{r.meaning}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}
