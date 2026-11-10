"use client";

import { toast } from "@/shared/Toaster";
import { vaultStore } from "./data/vault-mock";
import type { AgentRecord, VaultActor } from "./data/vault";
import { useRole } from "./RoleContext";
import { useVault } from "./useVault";
import { useTx } from "./TxContext";
import type { TxRequest } from "./ui/TxDialog";

/**
 * The owner and operator actions every agent screen shares. Each one asks through the tx dialog first, and a
 * refusal from the vault is shown as an ordinary outcome, never as a crash.
 */
export function useActions() {
  const vault = useVault();
  const { role } = useRole();
  const { open } = useTx();
  const actor: VaultActor = role === "operator" ? "operator" : "owner";
  const isOperator = actor === "operator";
  const signer = isOperator ? (vault.operator ?? "operator") : vault.owner;

  function run(f: () => void, done: string) {
    try {
      f();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The vault refused the call.");
    }
  }

  function ask(r: Omit<TxRequest, "signer" | "receiver"> & { receiver?: string }) {
    open({ signer, ...r, receiver: r.receiver ?? vault.vault });
  }

  const freeze = (a: AgentRecord) =>
    ask({
      title: "Freeze this agent?",
      actions: [`set status Paused on ${a.id}`],
      note: "The vault refuses its next call and records the refusal. Its key stays on the vault.",
      okLabel: "Freeze agent",
      onOk: () => run(() => vaultStore.setAgentStatus(a.id, "Paused", actor), `${a.id} is now Paused.`),
    });

  const resume = (a: AgentRecord) =>
    ask({
      title: "Resume this agent?",
      actions: [`set status Active on ${a.id}`],
      note: "The vault accepts its calls again and clears its refusal count.",
      okLabel: "Resume agent",
      onOk: () => run(() => vaultStore.setAgentStatus(a.id, "Active", actor), `${a.id} is now Active.`),
    });

  const revoke = (a: AgentRecord) =>
    ask({
      title: "Revoke this agent?",
      actions: [`delete key of ${a.id}, by the contract`],
      note: "The vault deletes this key. The network then rejects its transactions, so they never execute. Withdraw its balance to the owner whenever you like.",
      okLabel: "Delete the key",
      danger: true,
      onOk: () => run(() => vaultStore.setAgentStatus(a.id, "Revoked", actor), `${a.id} is now Revoked.`),
    });

  return { vault, actor, isOperator, signer, ask, run, freeze, resume, revoke };
}
