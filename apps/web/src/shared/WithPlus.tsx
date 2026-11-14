import { Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** A button label with a plus in front, for the buttons that make something new. */
export function WithPlus({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Plus size={16} weight="regular" aria-hidden />
      {children}
    </span>
  );
}
