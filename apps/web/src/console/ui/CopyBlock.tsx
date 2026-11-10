"use client";

import { Copy } from "@phosphor-icons/react";
import { toast } from "@/shared/Toaster";

export function CopyBlock({ text, label = "Copy" }: { text: string; label?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied.");
    } catch {
      toast.error("The browser blocked copying. Select the text and copy it by hand.");
    }
  }
  return (
    <div className="relative border border-line-2 bg-wash">
      <pre className="mono overflow-x-auto p-4 pr-24 text-[13px] leading-[1.6] break-all whitespace-pre-wrap">{text}</pre>
      <button
        type="button"
        onClick={copy}
        className="label absolute top-2 right-2 inline-flex cursor-pointer items-center gap-1.5 border border-line-2 bg-paper px-2.5 py-1.5 text-xs transition-colors hover:border-ink"
      >
        <Copy size={14} weight="regular" aria-hidden />
        {label}
      </button>
    </div>
  );
}
