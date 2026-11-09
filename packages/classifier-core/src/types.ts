// Shapes from docs/CLASSIFIER.md. This package is the only owner of them; every surface imports these.

export type RiskClass =
  | "immutable_verified"
  | "local_upgradeable"
  | "global_by_account"
  | "unknown";

export type MutabilityBasis =
  | "no_detected_path"
  | "full_access_key"
  | "upgrade_imports"
  | "own_code"
  | "global_owner"
  | "undetermined";

export type CodeRef =
  | { kind: "local"; codeHash: string }
  | { kind: "global_hash"; globalHash: string }
  | { kind: "global_account"; ownerAccount: string };

export interface ClassEvidence {
  accountId: string;
  /** Block height of the view_account read the classification started from. */
  checkedAtBlock: number;
  /** How the account references its code. Null when the account has no code or does not exist. */
  codeRef: CodeRef | null;
  /** Full-access keys, including full-access gas keys. Any of them can change the code. */
  fullAccessKeyCount: number;
  /** Recorded only. Function-call keys cannot perform account actions, so they do not affect the class. */
  functionCallKeyCount: number;
  /**
   * The field most monitoring watches: view_account.code_hash, verbatim. For an account bound to a
   * global contract it is the zero hash and never changes when the owner redeploys.
   */
  monitoredCodeHash: string | null;
  /** Hash of the code that actually executes, from view_code. For global_by_account it differs from the monitored field. */
  resolvedCodeHash: string | null;
  /** Scanned host functions found in the import section. Empty means clean. */
  upgradeImports: string[];
  mutabilityBasis: MutabilityBasis;
  /** True when the module's import section was read. False for no code, unavailable code or unparseable code. */
  wasmParsed: boolean;
}

export interface Classification {
  class: RiskClass;
  evidence: ClassEvidence;
}

/** view_account, as an RpcReader returns it. */
export type ViewAccount =
  | { exists: false; blockHeight: number }
  | {
      exists: true;
      blockHeight: number;
      /** view_account.code_hash, verbatim. */
      codeHash: string;
      /** view_account.global_contract_hash when present, else null. */
      globalContractHash: string | null;
      /** view_account.global_contract_account_id when present, else null. */
      globalContractAccountId: string | null;
    };

export type AccessKeyPermissionKind =
  | "full_access"
  | "function_call"
  | "gas_key_full_access"
  | "gas_key_function_call";

export interface AccessKeyList {
  keys: { publicKey: string; permission: AccessKeyPermissionKind }[];
}

/** view_code. Null when the node reports that the account has no contract code. */
export type ViewCode = { codeBase64: string; hash: string } | null;

/**
 * Three read-only RPC calls, implemented by the surface (browser fetch, Node, MCP, attestor).
 * The core never touches the network. A reader rejects only on transport failure: an account that
 * does not exist, or has no code, is a normal answer.
 */
export interface RpcReader {
  viewAccount(accountId: string): Promise<ViewAccount>;
  viewAccessKeyList(accountId: string): Promise<AccessKeyList>;
  viewCode(accountId: string): Promise<ViewCode>;
}
