import type { Network } from "@/lib/classifier-types";
import { VERIFY_REQUEST_TYPES, curlFor, isSafeAccountId } from "@/lib/verify-commands";

const WHAT: Record<(typeof VERIFY_REQUEST_TYPES)[number], string> = {
  view_account: "How the code is referenced (global_contract_hash / global_contract_account_id / code_hash). Check these fields in that order.",
  view_access_key_list: "Count keys whose permission is FullAccess. Function-call keys do not change the class.",
  view_code: "The code that actually runs. Its hash is the resolved hash, and its import section is what is scanned.",
};

export function Verify({ accountId, network }: { accountId: string; network: Network }) {
  if (!isSafeAccountId(accountId)) return null;
  return (
    <details className="verify">
      <summary>Verify this yourself</summary>
      <p className="note">
        Three read-only RPC calls produce all of the evidence. Anyone running them gets the same
        answer for the same block.
      </p>
      <ol>
        {VERIFY_REQUEST_TYPES.map((t) => (
          <li key={t}>
            <p><span className="mono">{t}</span>: {WHAT[t]}</p>
            <pre className="term">{curlFor(t, accountId, network)}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}
