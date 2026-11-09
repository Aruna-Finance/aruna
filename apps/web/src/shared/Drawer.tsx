"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "@phosphor-icons/react/dist/ssr";

/**
 * Right-hand panel that slides in from the edge. A native <dialog>, so focus is trapped, Escape closes it,
 * and the page behind cannot be used while it is open.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      setClosing(false);
      if (!d.open) d.showModal();
      return;
    }
    if (!d.open) return;
    // Play the slide-out, then really close. Reduced motion closes at once.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      d.close();
      return;
    }
    setClosing(true);
    const done = () => {
      setClosing(false);
      d.close();
    };
    const t = window.setTimeout(done, 260);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="drawer-title"
      data-closing={closing ? "" : undefined}
      onCancel={(e) => {
        // Escape: let the parent decide, so the slide-out can play first.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-svh max-h-none w-[min(460px,100vw)] border-l border-line-2 bg-paper p-0 text-ink backdrop:bg-ink/30 open:animate-drawer-in open:backdrop:animate-fade-in data-[closing]:animate-drawer-out data-[closing]:backdrop:animate-fade-out motion-reduce:animate-none motion-reduce:backdrop:animate-none"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line-2 px-6 py-5">
          <h2 id="drawer-title" className="text-xl font-medium">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 cursor-pointer p-2 transition-colors hover:bg-wash"
          >
            <X size={20} weight="regular" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      </div>
    </dialog>
  );
}
