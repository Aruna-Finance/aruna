"use client";

import { OperatorVault, OwnerVault, type CallResult, type Policy } from "@aruna/sdk/vault";
import { useMemo } from "react";
import { createTestnetReads } from "./chain-reads";
import { defaultHistory } from "./history";
import { useTx } from "./TxContext";
import { useWallet } from "./WalletContext";
import { createWalletTransport, sendNear } from "./wallet-transport";
import { yoctoToNear } from "./fmt";

const GAS_ADMIN = "30000000000000";

export interface LiveAction {
  title: string;
  /** Short name for the pending history row, such as "Pause agent". */
  label: string;
  method: string;
  /** yoctoNEAR the SDK attaches for this method. Shown in the dialog before the wallet opens. */
  depositYocto: string;
  actions: string[];
  note: string;
  okLabel: string;
  danger?: boolean;
  send: (c: { operator: OperatorVault; owner: OwnerVault }) => Promise<CallResult>;
  /** Runs when the call did not go through (declined, refused or failed), so a caller can undo local work. */
  onFail?: () => void;
  /** Runs once the call is confirmed on chain. */
  onDone?: (r: CallResult) => void;
}

/**
 * Real owner and operator calls on a live vault. The dialog is the preview (R13); the wallet opens only after
 * the user confirms there. A refusal or failure comes back as the dialog's refused or failed state.
 */
export function useLiveActions(vault: string, refresh: () => void) {
  const { accountId, getWallet } = useWallet();
  const { open } = useTx();
  const reads = useMemo(() => createTestnetReads(), []);
  const history = useMemo(() => defaultHistory(), []);

  function ask(a: LiveAction) {
    if (!accountId) return;
    open({
      title: a.title,
      signer: accountId,
      receiver: vault,
      method: a.method,
      depositYocto: a.depositYocto,
      gas: GAS_ADMIN,
      actions: a.actions,
      note: a.note,
      okLabel: a.okLabel,
      danger: a.danger,
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const transport = createWalletTransport({ wallet, signerId: accountId, ...reads });
        try {
          const r = await a.send({ operator: new OperatorVault({ vaultId: vault, transport }), owner: new OwnerVault({ vaultId: vault, transport }) });
          history.track({ hash: r.tx, vault, label: a.label });
          refresh();
          a.onDone?.(r);
          return r;
        } catch (e) {
          a.onFail?.();
          throw e;
        }
      },
    });
  }

  const pause = (publicKey: string, label: string) =>
    ask({
      title: "Pause this agent?",
      label: "Pause agent",
      method: "pause_agent",
      depositYocto: "0",
      actions: [`pause ${label}`, publicKey],
      note: "The vault refuses its next call. Its key stays on the vault, and the owner can resume it.",
      okLabel: "Pause agent",
      send: (c) => c.operator.pauseAgent(publicKey),
    });

  const resume = (publicKey: string, label: string) =>
    ask({
      title: "Resume this agent?",
      label: "Resume agent",
      method: "resume_agent",
      depositYocto: "1",
      actions: [`resume ${label}`, publicKey],
      note: "The vault accepts its calls again. Only the owner can do this.",
      okLabel: "Resume agent",
      send: (c) => c.owner.resumeAgent(publicKey),
    });

  const revoke = (publicKey: string, label: string) =>
    ask({
      title: "Revoke this agent?",
      label: "Revoke agent",
      method: "revoke_agent",
      depositYocto: "0",
      actions: [`delete the key of ${label}`, publicKey],
      note: "The vault deletes this key, so the network rejects its transactions. This cannot be undone; add a new agent instead.",
      okLabel: "Delete the key",
      danger: true,
      send: (c) => c.operator.revokeAgent(publicKey),
    });

  const addAgent = (o: { publicKey: string; label: string; policy: Policy; onDone: () => void; onFail: () => void }) =>
    ask({
      title: "Add this agent?",
      label: "Add agent",
      method: "add_agent",
      depositYocto: "1",
      actions: [`add agent ${o.label}`, o.publicKey, "the vault adds a function-call key to itself"],
      note: "The key can call spend and refresh_class on this vault only, within the policy. It has no account and holds no funds.",
      okLabel: "Create the agent",
      send: (c) => c.operator.createAgent({ publicKey: o.publicKey, label: o.label, policy: o.policy }),
      onDone: o.onDone,
      onFail: o.onFail,
    });

  const setPolicy = (publicKey: string, label: string, policy: Policy, tighter: boolean) =>
    ask({
      title: tighter ? "Tighten this policy?" : "Loosen this policy?",
      label: tighter ? "Tighten policy" : "Loosen policy",
      method: "update_policy",
      depositYocto: "1",
      actions: [`${tighter ? "tighten" : "loosen"} the policy of ${label}`, publicKey],
      note: "The vault applies the new limits from the next call. Existing exposure records do not change.",
      okLabel: "Save the policy",
      send: (c) => (tighter ? c.operator.tightenPolicy(publicKey, policy) : c.owner.updatePolicy(publicKey, policy)),
    });

  const withdraw = (amountYocto: string, owner: string) =>
    ask({
      title: `Withdraw ${yoctoToNear(amountYocto)} NEAR?`,
      label: "Withdraw to owner",
      method: "withdraw_to_owner",
      depositYocto: "1",
      actions: [`withdraw_to_owner: ${owner}`],
      note: "Owner-only, never an agent action. Funds can only go to the registered owner.",
      okLabel: "Withdraw to owner",
      send: (c) => c.owner.withdrawToOwner(amountYocto),
    });

  /** A plain NEAR transfer into the vault. No method on the vault is called. */
  function deposit(yocto: bigint) {
    if (!accountId) return;
    open({
      title: `Deposit ${yoctoToNear(yocto.toString())} NEAR?`,
      signer: accountId,
      receiver: vault,
      method: "transfer",
      depositYocto: yocto.toString(),
      actions: [`transfer ${yoctoToNear(yocto.toString())} NEAR to ${vault}`],
      note: "A plain transfer. Only the vault's rules can move it out again.",
      okLabel: "Deposit",
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const r = await sendNear({ wallet, signerId: accountId, receiver: vault, depositYocto: yocto });
        history.track({ hash: r.tx, vault, label: "Deposit" });
        refresh();
        return r;
      },
    });
  }

  const setOperator = (next: string | null, current: string | null) =>
    ask({
      title: next ? "Set the operator?" : "Remove the operator?",
      label: next ? "Set operator" : "Remove operator",
      method: "set_operator",
      depositYocto: "1",
      actions: [next ? `operator ${current ?? "none"} to ${next}` : `remove operator ${current ?? "none"}`],
      note: "The operator can add agents and tighten or pause them. It can never loosen limits, resume an agent or withdraw. Only the owner can change this.",
      okLabel: next ? "Set the operator" : "Remove the operator",
      danger: !next,
      send: (c) => c.owner.setOperator(next),
    });

  const setCeiling = (ceiling: Record<string, unknown>, summary: string[]) =>
    ask({
      title: "Change the vault limits?",
      label: "Change vault limits",
      method: "set_ceiling",
      depositYocto: "1",
      actions: summary,
      note: "Vault limits apply to every agent on this vault. Only the owner can change them.",
      okLabel: "Save the ceiling",
      send: (c) => c.owner.setCeiling(ceiling),
    });

  return { accountId, pause, resume, revoke, addAgent, setPolicy, withdraw, deposit, setOperator, setCeiling };
}
