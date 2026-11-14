import { Underwriter, type DepositResult, type WithdrawResult } from "@aruna/sdk/coverage";
import type { VaultTransport } from "@aruna/sdk/vault";
import { POOL } from "./price";
import { sharesToWithdraw } from "./underwriter-review";

// What runs when the underwriter confirms in the dialog: the SDK call, and a refresh of the screen only when the pool took the
// action. Kept apart from the hook so it needs no wallet or React to test. A refusal comes back to the dialog as an outcome.

export async function performDeposit(o: { transport: VaultTransport; token: string; amount: bigint; onDone: () => void }): Promise<DepositResult> {
  const r = await new Underwriter({ pool: POOL, transport: o.transport }).deposit({ token: o.token, amount: o.amount.toString() });
  if (r.ok) o.onDone();
  return r;
}

export async function performWithdraw(o: {
  transport: VaultTransport;
  token: string;
  plan: { all: true } | { shares: bigint };
  readHeld: () => Promise<bigint>;
  onDone: () => void;
}): Promise<WithdrawResult> {
  const shares = await sharesToWithdraw(o.plan, o.readHeld);
  const r = await new Underwriter({ pool: POOL, transport: o.transport }).withdraw({ token: o.token, shares });
  if (r.ok) o.onDone();
  return r;
}
