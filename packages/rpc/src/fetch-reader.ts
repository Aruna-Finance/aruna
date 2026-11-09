// An RpcReader over public NEAR JSON-RPC using only `fetch`, so it runs in a browser tab, Node 20+
// and any worker. Response shapes checked against live nodes on 9 November 2026 (protocol 88).

import type { AccessKeyList, AccessKeyPermissionKind, RpcReader, ViewAccount, ViewCode } from "@aruna/classifier-core";
import { isValidAccountId } from "./account-id.js";
import { DEFAULT_ENDPOINTS, type Network } from "./endpoints.js";
import { RpcRequestError, RpcTransportError } from "./errors.js";

export interface FetchReaderOptions {
  /** Picks the built-in endpoints. Ignored when `endpoints` is given. Defaults to mainnet. */
  network?: Network;
  /** Endpoints tried in order until one answers. */
  endpoints?: readonly string[];
  /** Per-attempt timeout. Default 10 seconds. */
  timeoutMs?: number;
  /** Injected for tests and non-standard runtimes. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface FetchReader extends RpcReader {
  readonly endpoints: readonly string[];
}

/** Node answers that are facts about the account, not failures. */
type Handled = { handled: "UNKNOWN_ACCOUNT" | "NO_CONTRACT_CODE"; blockHeight: number };

type JsonRpcError = { name?: string; cause?: { name?: string; info?: Record<string, unknown> }; message?: string; data?: unknown };

const HANDLED = new Set(["UNKNOWN_ACCOUNT", "NO_CONTRACT_CODE"]);

class AttemptFailed extends Error {}

export function createFetchReader(options: FetchReaderOptions = {}): FetchReader {
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS[options.network ?? "mainnet"];
  if (endpoints.length === 0) throw new RpcRequestError("at least one RPC endpoint is required");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function attempt(url: string, params: Record<string, unknown>): Promise<Record<string, unknown> | Handled> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AttemptFailed(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "aruna", method: "query", params }),
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (!res.ok) throw new AttemptFailed(`HTTP ${res.status}`);
      const body = (await Promise.race([res.json(), timeout])) as { result?: Record<string, unknown>; error?: JsonRpcError };
      if (body.error) {
        const cause = body.error.cause?.name ?? body.error.name ?? "unknown error";
        if (HANDLED.has(cause)) {
          const h = body.error.cause?.info?.block_height;
          return { handled: cause as Handled["handled"], blockHeight: typeof h === "number" ? h : 0 };
        }
        if (cause === "TOO_MANY_ACCESS_KEYS") {
          // A node limit, the same on every endpoint: the key list cannot be read over RPC.
          throw new RpcRequestError("the account has more access keys than view_access_key_list returns (TOO_MANY_ACCESS_KEYS)");
        }
        if (body.error.name === "REQUEST_VALIDATION_ERROR") {
          throw new RpcRequestError(`node rejected the request: ${String(body.error.data ?? body.error.message ?? cause)}`);
        }
        throw new AttemptFailed(`node error ${cause}`);
      }
      if (!body.result || typeof body.result !== "object") throw new AttemptFailed("response has no result");
      if ("error" in body.result) throw new AttemptFailed(`result carries an error: ${String(body.result.error)}`);
      return body.result;
    } catch (e) {
      if (e instanceof RpcRequestError || e instanceof AttemptFailed) throw e;
      throw new AttemptFailed(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async function query<T>(
    requestType: string,
    accountId: string,
    map: (r: Record<string, unknown> | Handled) => T,
  ): Promise<T> {
    if (!isValidAccountId(accountId)) throw new RpcRequestError(`invalid NEAR account id: ${JSON.stringify(accountId)}`);
    const params = { request_type: requestType, finality: "final", account_id: accountId };
    const attempts: { url: string; error: string }[] = [];
    for (const url of endpoints) {
      try {
        return map(await attempt(url, params));
      } catch (e) {
        if (e instanceof RpcRequestError) throw e;
        attempts.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }
    throw new RpcTransportError(`${requestType}(${accountId})`, attempts);
  }

  const isHandled = (r: Record<string, unknown> | Handled): r is Handled => "handled" in r;
  const str = (v: unknown, field: string): string => {
    if (typeof v !== "string") throw new AttemptFailed(`missing ${field}`);
    return v;
  };
  const height = (r: Record<string, unknown>): number => {
    if (typeof r.block_height !== "number") throw new AttemptFailed("missing block_height");
    return r.block_height;
  };

  return {
    endpoints,

    viewAccount: (accountId) =>
      query<ViewAccount>("view_account", accountId, (r) => {
        if (isHandled(r)) {
          if (r.handled !== "UNKNOWN_ACCOUNT") throw new AttemptFailed(`unexpected ${r.handled}`);
          return { exists: false, blockHeight: r.blockHeight };
        }
        return {
          exists: true,
          blockHeight: height(r),
          codeHash: str(r.code_hash, "code_hash"),
          globalContractHash: typeof r.global_contract_hash === "string" ? r.global_contract_hash : null,
          globalContractAccountId: typeof r.global_contract_account_id === "string" ? r.global_contract_account_id : null,
        };
      }),

    viewAccessKeyList: (accountId) =>
      query<AccessKeyList>("view_access_key_list", accountId, (r) => {
        if (isHandled(r)) {
          if (r.handled !== "UNKNOWN_ACCOUNT") throw new AttemptFailed(`unexpected ${r.handled}`);
          return { keys: [] };
        }
        if (!Array.isArray(r.keys)) throw new AttemptFailed("missing keys");
        return {
          keys: r.keys.map((k: { public_key?: unknown; access_key?: { permission?: unknown } }) => ({
            publicKey: str(k.public_key, "public_key"),
            permission: permissionKind(k.access_key?.permission),
          })),
        };
      }),

    viewCode: (accountId) =>
      query<ViewCode>("view_code", accountId, (r) => {
        if (isHandled(r)) return null;
        return { codeBase64: str(r.code_base64, "code_base64"), hash: str(r.hash, "hash") };
      }),
  };
}

/** Unrecognised shapes fail the attempt: a key we cannot read must never be counted as harmless. */
function permissionKind(p: unknown): AccessKeyPermissionKind {
  if (p === "FullAccess") return "full_access";
  if (p && typeof p === "object") {
    if ("FunctionCall" in p) return "function_call";
    if ("GasKeyFullAccess" in p) return "gas_key_full_access";
    if ("GasKeyFunctionCall" in p) return "gas_key_function_call";
  }
  throw new AttemptFailed(`unrecognised access key permission ${JSON.stringify(p)}`);
}
