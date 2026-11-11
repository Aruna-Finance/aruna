import { MAX_CLASS_AGE_BLOCKS } from "../data/types";

/** Targets are looked up at runtime, so the detail page takes the id from the query string. */
export const targetHref = (id: string) => `/console/targets/detail/?id=${encodeURIComponent(id)}`;

export function Freshness({ age }: { age: number }) {
  const stale = age > MAX_CLASS_AGE_BLOCKS;
  return (
    <span
      className={`mono inline-block whitespace-nowrap border px-2 py-0.5 text-xs ${stale ? "border-dawn-ink bg-dawn-wash text-dawn-ink" : "border-line-2"}`}
      title={
        stale
          ? "Older than the vault's staleness bound. A spend returns ARUNA_CLASS_STALE until it is refreshed."
          : `Within the staleness bound of ${MAX_CLASS_AGE_BLOCKS.toLocaleString("en-US")} blocks.`
      }
    >
      {stale ? "stale" : "fresh"} · {age.toLocaleString("en-US")} blocks
    </span>
  );
}

/** What a history panel says when it is not simply live (R10). Never an empty list in place of "unavailable". */
export function historyNotice(h: { state: "live" } | { state: "behind"; pending: { label: string }[] } | { state: "unavailable"; lastKnownBlock: number | null }, source: "live" | "fixture"): string | null {
  if (h.state === "unavailable") {
    return h.lastKnownBlock === null
      ? "History is unavailable: the indexer could not be reached. Balances, agents and actions still work."
      : `History is unavailable since block ${h.lastKnownBlock.toLocaleString("en-US")}. Balances, agents and actions still work.`;
  }
  if (h.state === "behind") {
    const n = h.pending.length;
    return `The indexer has not caught up with ${n} ${n === 1 ? "transaction" : "transactions"} you just sent. They show as pending until it does.`;
  }
  return source === "fixture" ? "Recorded sample history, not read from the live indexer." : null;
}
