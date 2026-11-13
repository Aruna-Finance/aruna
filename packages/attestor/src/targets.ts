import { createIndexerClient } from "@aruna/indexer/client";

export interface TargetDeps {
  attestor: string;
  seed: string[];
  last: string[];
  /** The targets the indexer lists for this attestor. Absent when no indexer is configured; rejects when it cannot be read. */
  assigned?: () => Promise<string[]>;
  assignedAttestor: (target: string) => Promise<string | null>;
  log: (msg: string) => void;
}

const unique = (xs: string[]) => [...new Set(xs)];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function resolveTargets(d: TargetDeps): Promise<string[]> {
  let candidates: string[];
  if (!d.assigned) {
    candidates = unique([...d.seed, ...d.last]);
  } else {
    try {
      candidates = unique([...d.seed, ...(await d.assigned())]);
    } catch (e) {
      d.log(`assignment source unreachable, keeping the last confirmed list (${msg(e)})`);
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
      if (d.last.includes(target)) {
        confirmed.push(target);
        d.log(`${target}: could not confirm the assignment, keeping it (${msg(e)})`);
      } else d.log(`${target}: could not confirm the assignment, not watching it yet (${msg(e)})`);
    }
  }
  return confirmed;
}

export function indexerAssignments(o: { baseUrl: string; attestor: string; registry: string; fetch?: typeof fetch }): () => Promise<string[]> {
  const client = createIndexerClient({ baseUrl: o.baseUrl, fetch: o.fetch });
  return async () => {
    const page = await client.attestors({ registry: o.registry, attestor: o.attestor });
    return page.items.filter((a) => a.attestor === o.attestor && a.registry === o.registry).flatMap((a) => a.targets);
  };
}
