"use client";

import { useEffect, useRef, useState } from "react";
import { classLabelOf } from "@/landing/lib/class-labels";
import { Button } from "@/shared/Button";
import { Disclosure } from "@/shared/Disclosure";
import { reasonText } from "../reason-text";
import { yoctoToNear } from "../fmt";
import { explorerTxUrl, runTx, type TxPhase } from "../tx-status";

export interface TxRequest {
  title: string;
  signer: string;
  receiver: string;
  actions: string[];
  /** For a real call: the method, the deposit in yoctoNEAR and the gas, shown before the wallet opens (R13). */
  method?: string;
  depositYocto?: string;
  gas?: string;
  note?: string;
  okLabel?: string;
  danger?: boolean;
  /**
   * A mock action returns nothing and the dialog closes at once. A real call returns a promise: the dialog then
   * stays open and shows signing, confirmed (with an explorer link), refused (with its reason code) or failed.
   */
  onOk: () => unknown;
}

const isPromise = (v: unknown): v is Promise<unknown> => typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/** What the user pays: the 1 yoctoNEAR security deposit some calls require is shown as none here, and exactly under Details. */
export function amountText(yocto: string | undefined): string {
  if (yocto === undefined || yocto === "0" || yocto === "1") return "none";
  return `${yoctoToNear(yocto)} NEAR`;
}

/** "none", "1 yoctoNEAR", or NEAR. A deposit is never hidden. */
export function depositText(yocto: string | undefined): string {
  if (yocto === undefined || yocto === "0") return "none";
  if (yocto === "1") return "1 yoctoNEAR";
  return `${yoctoToNear(yocto)} NEAR`;
}

export const gasText = (gas: string | undefined) => (gas === undefined ? null : `${(BigInt(gas) / 10n ** 12n).toString()} Tgas`);

/** What the user sees once the action has run. */
export function PhaseView({ phase }: { phase: TxPhase }) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "signing":
      return (
        <p className="mt-4 text-sm" role="status">
          Waiting for the wallet. Approve the transaction there.
        </p>
      );
    case "confirmed":
      return (
        <p className="mt-4 border-l-[3px] border-ink bg-fog px-4 py-3 text-sm leading-[1.6]" role="status">
          Confirmed.{" "}
          {phase.hash && (
            <a href={explorerTxUrl(phase.hash)} target="_blank" rel="noreferrer" className="mono underline underline-offset-4">
              View transaction
            </a>
          )}
        </p>
      );
    case "refused":
      return (
        <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]" role="status">
          Blocked by the vault. {reasonText(phase.reason) ?? "It refused this action."}
          {phase.targetClass && <> (Contract risk: {classLabelOf(phase.targetClass)}.)</>} No funds moved, and the refusal is recorded.{" "}
          <span className="mono text-xs text-muted">ARUNA_{phase.reason}</span>{" "}
          {phase.hash && (
            <a href={explorerTxUrl(phase.hash)} target="_blank" rel="noreferrer" className="mono underline underline-offset-4">
              View transaction
            </a>
          )}
        </p>
      );
    case "failed":
      return (
        <div className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]" role="alert">
          {phase.sent ? "The network or the contract rejected it." : "It couldn\u2019t be sent, or its result couldn\u2019t be read."}
          {!phase.sent && " Check the explorer before you try again, in case it ran."}
          {(phase.reason || phase.message) && (
            <Disclosure title="Details" className="mt-2 text-sm [&>summary]:font-normal">
              <p className="mono mt-2 break-words text-xs">
                {phase.reason && `${phase.reason} `}
                {phase.message}
              </p>
            </Disclosure>
          )}
        </div>
      );
    case "cancelled":
      return (
        <p className="mt-4 text-sm" role="status">
          Cancelled. Nothing was sent.
        </p>
      );
  }
}

/** The confirmation every state-changing action goes through: who signs, to whom, which actions, and why. */
export function TxDialog({ tx, onClose }: { tx: TxRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<TxPhase>({ kind: "idle" });
  const busy = phase.kind === "signing";

  useEffect(() => {
    setPhase({ kind: "idle" });
    const d = ref.current;
    if (!d) return;
    if (tx && !d.open) d.showModal();
    if (!tx && d.open) d.close();
  }, [tx]);

  const done = phase.kind !== "idle" && phase.kind !== "signing";
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="tx-title"
      onClose={close}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      className="m-auto w-[min(520px,calc(100vw-2rem))] border border-line-2 bg-paper p-0 text-ink backdrop:bg-ink/30"
    >
      {tx && (
        <div className="p-6 md:p-8">
          <h2 id="tx-title" className="text-xl font-medium">
            {tx.title}
          </h2>
          <dl className="mt-5 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">From</dt>
            <dd className="mono break-all">{tx.signer}</dd>
            <dt className="text-muted">To</dt>
            <dd className="mono break-all">{tx.receiver}</dd>
            {tx.depositYocto !== undefined && (
              <>
                <dt className="text-muted">Amount</dt>
                <dd className="mono">{amountText(tx.depositYocto)}</dd>
              </>
            )}
            <dt className="text-muted">What it does</dt>
            <dd>
              <ul className="grid gap-1">
                {tx.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </dd>
          </dl>
          {(tx.method || tx.gas !== undefined || tx.depositYocto !== undefined) && (
            <Disclosure title="Details" className="mt-4 text-sm [&>summary]:font-normal [&>summary]:text-muted">
              <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2">
                {tx.method && (
                  <>
                    <dt className="text-muted">Method</dt>
                    <dd className="mono">{tx.method}</dd>
                  </>
                )}
                {tx.depositYocto !== undefined && (
                  <>
                    <dt className="text-muted">Deposit</dt>
                    <dd className="mono">{depositText(tx.depositYocto)}</dd>
                  </>
                )}
                {tx.gas !== undefined && (
                  <>
                    <dt className="text-muted">Gas</dt>
                    <dd className="mono">{gasText(tx.gas)}</dd>
                  </>
                )}
              </dl>
            </Disclosure>
          )}
          {tx.note && <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">{tx.note}</p>}
          <PhaseView phase={phase} />
          <div className="mt-6 flex flex-wrap gap-3">
            {!done && (
              <Button
                type="button"
                variant={tx.danger ? "dark" : "primary"}
                disabled={busy}
                onClick={() => {
                  const out = tx.onOk();
                  if (!isPromise(out)) {
                    onClose();
                    return;
                  }
                  void runTx(() => out, setPhase);
                }}
              >
                {busy ? "Waiting for the wallet" : (tx.okLabel ?? "Confirm")}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              {done ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
