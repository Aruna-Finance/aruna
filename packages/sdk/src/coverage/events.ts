// NEP-297 events ("standard": "aruna") out of a transaction's receipt logs. A coverage purchase or
// claim finishes in callbacks, so its outcome is in the logs, not in the call's return value.
export interface ArunaEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseEvents(logs: readonly string[] | undefined): ArunaEvent[] {
  const out: ArunaEvent[] = [];
  for (const line of logs ?? []) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(line.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown[] };
      if (e.standard === "aruna" && typeof e.event === "string") out.push({ event: e.event, data: (e.data?.[0] ?? {}) as Record<string, unknown> });
    } catch {
      // not ours, or not JSON: ignore
    }
  }
  return out;
}
