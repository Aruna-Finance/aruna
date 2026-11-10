import type { RiskClass } from "@/landing/lib/classifier-types";

/** Unknown is never styled as safe: dashed rule, muted text, no reassuring colour. */
export function ClassTag({ c }: { c: RiskClass }) {
  const unknown = c === "unknown";
  return (
    <span
      className={`mono inline-block text-[13px] ${
        unknown ? "border-l-[3px] border-dashed border-muted pl-2 text-muted" : c === "global_by_account" ? "text-dawn-ink" : ""
      }`}
    >
      {c}
    </span>
  );
}
