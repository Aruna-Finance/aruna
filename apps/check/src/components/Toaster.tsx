"use client";
import { useEffect } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

/** Mounted once in the root layout. Also turns uncaught errors into error toasts. */
export function Toaster() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => toast.error(e.message || "Something went wrong.");
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      toast.error(r instanceof Error ? r.message : "A request failed. Try again.");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <Sonner
      position="bottom-right"
      closeButton
      icons={{
        success: <CheckCircle size={20} weight="regular" />,
        error: <WarningCircle size={20} weight="regular" />,
        close: <X size={14} weight="regular" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "label flex w-[356px] max-w-[calc(100vw-32px)] items-start gap-3 border bg-white px-4 py-3.5 text-sm normal-case tracking-normal",
          success: "border-ink",
          error: "border-dawn-ink bg-dawn-wash",
          title: "font-sans text-[15px] font-medium",
          description: "font-sans text-[13px] text-muted",
          closeButton: "absolute top-2 right-2 cursor-pointer text-muted hover:text-ink",
        },
      }}
    />
  );
}

export { toast };
