import type { ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";

/** Native <details> with a regular-weight caret instead of the browser marker. */
export function Disclosure({
  title,
  open,
  children,
  className = "",
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details open={open} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <CaretRight
          size={16}
          weight="regular"
          aria-hidden
          className="transition-transform group-open:rotate-90"
        />
        {title}
      </summary>
      {children}
    </details>
  );
}
