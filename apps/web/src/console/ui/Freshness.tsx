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
