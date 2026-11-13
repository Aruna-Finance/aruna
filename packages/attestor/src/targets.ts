// The targets this attestor watches: whatever the registry assigns to it (KTD4). The indexer says which targets
// are assigned, and a seed list covers what a lagging indexer does not show yet; every candidate is confirmed with
// the registry's `assigned_attestor` before it is watched, so neither source alone can make the attestor watch,
// or report on, a target that is not assigned to it.
import { createIndexerClient } from "@aruna/indexer/client";

export interface TargetDeps {
  attestor: string;
  /** Targets from configuration, confirmed like any other. */
  seed: string[];
  /** The list the registry last confirmed, kept when the assignment source cannot be read. */
  last: string[];
  /** The targets the indexer lists for this attestor. Absent when no indexer is configured; rejects when it cannot be read. */
  assigned?: () => Promise<string[]>;
  /** The registry's `assigned_attestor` for a target. */
  assignedAttestor: (target: string) => Promise<string | null>;
  log: (msg: string) => void;
}

const unique = (xs: string[]) => [...new Set(xs)];

export async function resolveTargets(d: TargetDeps): Promise<string[]> {
  let candidates: string[];
  if (!d.assigned) {
    candidates = unique([...d.seed, ...d.last]);
  } else {
    try {
      candidates = unique([...d.seed, ...(await d.assigned())]);
    } catch (e) {
      d.log(`assignment source unreachable, keeping the last confirmed list (${e instanceof Error ? e.message : e})`);
      candidates = unique([...d.seed, ...d.last]);
    }
  }
  const confirmed: string[] = [];
  for (const target of candidates) {
    try {
      const owner = await d.assignedAttestor(target);
      if (owner === d.attestor) confirmed.push(target);
      else d.log(`${target}: the registry assigns it to ${owner ?? "no attestor"}, not ${d.attestor}; not watching it`);
    } catch (e) {
      // A failed read is not evidence the assignment ended: keep a target already watched, skip one never confirmed.
      if (d.last.includes(target)) {
        confirmed.push(target);
        d.log(`${target}: could not confirm the assignment, keeping it (${e instanceof Error ? e.message : e})`);
      } else d.log(`${target}: could not confirm the assignment, not watching it yet (${e instanceof Error ? e.message : e})`);
    }
  }
  return confirmed;
}

/** The targets the indexer lists for `attestor` on `registry`, over its read API. */
export function indexerAssignments(o: { baseUrl: string; attestor: string; registry: string; fetch?: typeof fetch }): () => Promise<string[]> {
  const client = createIndexerClient({ baseUrl: o.baseUrl, fetch: o.fetch });
  return async () => {
    const page = await client.attestors({ registry: o.registry, attestor: o.attestor });
    return page.items.filter((a) => a.attestor === o.attestor && a.registry === o.registry).flatMap((a) => a.targets);
  };
}
