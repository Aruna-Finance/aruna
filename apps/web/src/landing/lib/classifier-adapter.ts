// Live classification in the browser: @aruna/classifier-core over public RPC via @aruna/rpc.
// No backend, no wallet. This file wires the engine to the UI and implements no check itself.
import { classify } from "@aruna/classifier-core";
import { createFetchReader, isValidAccountId, RpcRequestError, RpcTransportError } from "@aruna/rpc";
import type { LookupResult, Network } from "./classifier-types";

export { ZERO_HASH } from "@aruna/classifier-core";

/** Live testnet accounts, one per class (fixtures/README.md). */
export const EXAMPLE_ACCOUNTS = [
  "fx-imm.arunafi.testnet",
  "fx-upg.arunafi.testnet",
  "fx-guser.arunafi.testnet",
  "fx-nocode.arunafi.testnet",
];

const readers = new Map<Network, ReturnType<typeof createFetchReader>>();
const readerFor = (network: Network) => {
  let r = readers.get(network);
  if (!r) readers.set(network, (r = createFetchReader({ network })));
  return r;
};

export async function lookup(accountId: string, network: Network): Promise<LookupResult> {
  const id = accountId.trim();
  if (!isValidAccountId(id)) return { ok: false, reason: `"${id}" is not a valid NEAR account id.` };
  try {
    return { ok: true, classification: await classify(id, readerFor(network)), source: "live" };
  } catch (e) {
    if (e instanceof RpcTransportError) return { ok: false, reason: `Public RPC did not answer for ${network}. Nothing was classified; try again.` };
    if (e instanceof RpcRequestError) return { ok: false, reason: e.message };
    throw e;
  }
}
