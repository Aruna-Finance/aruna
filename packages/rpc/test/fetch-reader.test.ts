import { describe, expect, it } from "vitest";
import { classify } from "@aruna/classifier-core";
import { createFetchReader, isValidAccountId, RpcRequestError, RpcTransportError } from "../src/index.js";

type Handler = (url: string, body: { method: string; params: Record<string, unknown> }) => Response | Promise<Response>;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const ok = (result: unknown) => json({ jsonrpc: "2.0", id: "aruna", result });
const handlerError = (cause: string, extra: Record<string, unknown> = {}) =>
  json({ jsonrpc: "2.0", id: "aruna", error: { name: "HANDLER_ERROR", cause: { name: cause, info: extra }, code: -32000, message: "Server error" } });

function fakeFetch(handler: Handler) {
  const seen: { url: string; method: string; params: Record<string, unknown> }[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    seen.push({ url, method: body.method, params: body.params });
    return handler(url, body);
  };
  return { fetch: f as typeof fetch, seen };
}

const A = "https://a.example";
const B = "https://b.example";

describe("createFetchReader", () => {
  it("maps view_account with a global account reference unchanged", async () => {
    const { fetch } = fakeFetch(() =>
      ok({ amount: "1", block_height: 325, code_hash: "11111111111111111111111111111111", global_contract_account_id: "owner.sandbox", storage_usage: 195 }),
    );
    const r = createFetchReader({ endpoints: [A], fetch });
    expect(await r.viewAccount("user-a.sandbox")).toEqual({
      exists: true,
      blockHeight: 325,
      codeHash: "11111111111111111111111111111111",
      globalContractHash: null,
      globalContractAccountId: "owner.sandbox",
    });
  });

  it("sends a final-finality query with the request type and account", async () => {
    const { fetch, seen } = fakeFetch(() => ok({ block_height: 1, keys: [] }));
    await createFetchReader({ endpoints: [A], fetch }).viewAccessKeyList("x.testnet");
    expect(seen[0]).toEqual({ url: A, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: "x.testnet" } });
  });

  it("maps every access key permission shape", async () => {
    const { fetch } = fakeFetch(() =>
      ok({
        block_height: 1,
        keys: [
          { public_key: "ed25519:a", access_key: { nonce: 1, permission: "FullAccess" } },
          { public_key: "ed25519:b", access_key: { nonce: 1, permission: { FunctionCall: { allowance: null, receiver_id: "x", method_names: [] } } } },
          { public_key: "ed25519:c", access_key: { nonce: 1, permission: { GasKeyFullAccess: { balance: "1", num_nonces: 1 } } } },
          { public_key: "ed25519:d", access_key: { nonce: 1, permission: { GasKeyFunctionCall: [{ balance: "1" }, {}] } } },
        ],
      }),
    );
    const list = await createFetchReader({ endpoints: [A], fetch }).viewAccessKeyList("x.testnet");
    expect(list.keys.map((k) => k.permission)).toEqual(["full_access", "function_call", "gas_key_full_access", "gas_key_function_call"]);
  });

  it("an unrecognised key permission is a transport error, never silently a function-call key", async () => {
    const { fetch } = fakeFetch(() => ok({ block_height: 1, keys: [{ public_key: "ed25519:a", access_key: { permission: { Mystery: {} } } }] }));
    await expect(createFetchReader({ endpoints: [A], fetch }).viewAccessKeyList("x.testnet")).rejects.toBeInstanceOf(RpcTransportError);
  });

  it("UNKNOWN_ACCOUNT is a normal answer: the account does not exist", async () => {
    const { fetch } = fakeFetch(() => handlerError("UNKNOWN_ACCOUNT", { block_height: 9, requested_account_id: "nope.testnet" }));
    expect(await createFetchReader({ endpoints: [A], fetch }).viewAccount("nope.testnet")).toEqual({ exists: false, blockHeight: 9 });
  });

  it("NO_CONTRACT_CODE is a normal answer: view_code returns null", async () => {
    const { fetch } = fakeFetch(() => handlerError("NO_CONTRACT_CODE"));
    expect(await createFetchReader({ endpoints: [A], fetch }).viewCode("aruna.testnet")).toBeNull();
  });

  it("maps view_code to base64 and hash", async () => {
    const { fetch } = fakeFetch(() => ok({ block_height: 1, code_base64: "AGFzbQEAAAA=", hash: "H" }));
    expect(await createFetchReader({ endpoints: [A], fetch }).viewCode("x.testnet")).toEqual({ codeBase64: "AGFzbQEAAAA=", hash: "H" });
  });

  it("falls back to the next endpoint when the first times out", async () => {
    const { fetch, seen } = fakeFetch((url) =>
      url === A ? new Promise<Response>(() => {}) : ok({ block_height: 5, code_hash: "C", storage_usage: 1 }),
    );
    const acct = await createFetchReader({ endpoints: [A, B], fetch, timeoutMs: 20 }).viewAccount("x.testnet");
    expect(acct).toMatchObject({ exists: true, codeHash: "C" });
    expect(seen.map((s) => s.url)).toEqual([A, B]);
  });

  it("falls back on HTTP errors and unexpected node errors", async () => {
    const { fetch, seen } = fakeFetch((url) =>
      url === A ? json({ message: "rate limited" }, 429) : url === B ? handlerError("UNAVAILABLE_SHARD") : ok({ block_height: 5, code_hash: "C" }),
    );
    const C = "https://c.example";
    await createFetchReader({ endpoints: [A, B, C], fetch }).viewAccount("x.testnet");
    expect(seen.map((s) => s.url)).toEqual([A, B, C]);
  });

  it("rejects with every endpoint's failure when all fail", async () => {
    const { fetch } = fakeFetch((url) => (url === A ? json({}, 502) : Promise.reject(new TypeError("network down"))));
    const err = await createFetchReader({ endpoints: [A, B], fetch }).viewAccount("x.testnet").catch((e) => e);
    expect(err).toBeInstanceOf(RpcTransportError);
    expect(err.attempts.map((a: { url: string }) => a.url)).toEqual([A, B]);
    expect(err.attempts[1].error).toMatch(/network down/);
  });

  it("a request the node rejects as invalid is not retried and is not a transport error", async () => {
    const { fetch, seen } = fakeFetch(() =>
      json({ jsonrpc: "2.0", id: "aruna", error: { name: "REQUEST_VALIDATION_ERROR", cause: { name: "PARSE_ERROR", info: {} }, code: -32700, message: "Parse error" } }),
    );
    await expect(createFetchReader({ endpoints: [A, B], fetch }).viewAccount("x.testnet")).rejects.toBeInstanceOf(RpcRequestError);
    expect(seen).toHaveLength(1);
  });

  it("TOO_MANY_ACCESS_KEYS is not retried elsewhere: every node has the same limit", async () => {
    const { fetch, seen } = fakeFetch(() => handlerError("TOO_MANY_ACCESS_KEYS"));
    const err = await createFetchReader({ endpoints: [A, B], fetch }).viewAccessKeyList("big.near").catch((e) => e);
    expect(err).toBeInstanceOf(RpcRequestError);
    expect(err.message).toMatch(/TOO_MANY_ACCESS_KEYS/);
    expect(seen).toHaveLength(1);
  });

  it("rejects an invalid account id before any request", async () => {
    const { fetch, seen } = fakeFetch(() => ok({}));
    await expect(createFetchReader({ endpoints: [A], fetch }).viewAccount("Bad..Id")).rejects.toBeInstanceOf(RpcRequestError);
    expect(seen).toHaveLength(0);
  });

  it("feeds classify end to end: a missing account classifies unknown with two reads", async () => {
    const { fetch, seen } = fakeFetch(() => handlerError("UNKNOWN_ACCOUNT", { block_height: 9 }));
    const c = await classify("nope.testnet", createFetchReader({ endpoints: [A], fetch }));
    expect(c.class).toBe("unknown");
    expect(seen).toHaveLength(1);
  });

  it("uses the built-in endpoints for a network", () => {
    expect(createFetchReader({ network: "testnet" }).endpoints[0]).toBe("https://rpc.testnet.fastnear.com");
    expect(createFetchReader({ network: "mainnet" }).endpoints[0]).toBe("https://rpc.mainnet.fastnear.com");
  });
});

describe("isValidAccountId", () => {
  it.each(["near", "wrap.near", "a-b_c.testnet", "0x1234567890abcdef1234567890abcdef12345678", "f".repeat(64)])("accepts %s", (id) => {
    expect(isValidAccountId(id)).toBe(true);
  });
  it.each(["", "a", "Bad.near", "a..b", ".a", "a.", "a-", "-a", "a_.b", "a b", "a".repeat(65)])("rejects %j", (id) => {
    expect(isValidAccountId(id)).toBe(false);
  });
});
