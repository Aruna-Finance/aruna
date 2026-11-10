"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/shared/Button";

export interface TxRequest {
  title: string;
  signer: string;
  receiver: string;
  actions: string[];
  note?: string;
  okLabel?: string;
  danger?: boolean;
  onOk: () => void;
}

/** The confirmation every state-changing action goes through: who signs, to whom, which actions, and why. */
export function TxDialog({ tx, onClose }: { tx: TxRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (tx && !d.open) d.showModal();
    if (!tx && d.open) d.close();
  }, [tx]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="tx-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(520px,calc(100vw-2rem))] border border-line-2 bg-paper p-0 text-ink backdrop:bg-ink/30"
    >
      {tx && (
        <div className="p-6 md:p-8">
          <h2 id="tx-title" className="text-xl font-medium">
            {tx.title}
          </h2>
          <dl className="mt-5 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Signer</dt>
            <dd className="mono">{tx.signer}</dd>
            <dt className="text-muted">Receiver</dt>
            <dd className="mono">{tx.receiver}</dd>
            <dt className="text-muted">Actions</dt>
            <dd>
              <ul className="grid gap-1">
                {tx.actions.map((a) => (
                  <li key={a} className="mono">
                    {a}
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
          {tx.note && <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">{tx.note}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              variant={tx.danger ? "dark" : "primary"}
              onClick={() => {
                tx.onOk();
                onClose();
              }}
            >
              {tx.okLabel ?? "Confirm"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
