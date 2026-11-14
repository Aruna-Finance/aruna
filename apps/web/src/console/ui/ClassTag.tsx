import Link from "next/link";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { CLASS_INFO, classHint } from "../classInfo";
import { targetHref } from "./Freshness";

/**
 * Unknown is never styled as safe: dashed rule, muted text, no reassuring colour. The hover text carries the
 * class's basis, and with a `target` the tag links to that target's evidence, so a class is never a bare badge
 * (docs/FRONTEND.md, non-negotiables 5, 6 and 9).
 */
export function ClassTag({ c, target }: { c: RiskClass; target?: string }) {
  const unknown = c === "unknown";
  const cls = `inline-block text-[14px] ${
    unknown ? "border-l-[3px] border-dashed border-muted pl-2 text-muted" : c === "global_by_account" ? "text-dawn-ink" : ""
  }`;
  const title = classHint(c);
  if (target) {
    return (
      <Link href={targetHref(target)} className={`${cls} underline underline-offset-4`} title={`${title} Open the evidence.`}>
        {CLASS_INFO[c].title}
      </Link>
    );
  }
  return (
    <span className={`${cls} cursor-help underline decoration-dotted underline-offset-4`} title={title}>
      {CLASS_INFO[c].title}
    </span>
  );
}
