// What the attestor keeps between polls and across restarts: its report nonce, the last observation of each
// target, and the last list of targets the registry confirmed. A lost observation makes the current code the new
// baseline, so a change made while the daemon was down is never reported: on a container, point
// ARUNA_ATTESTOR_STATE_DIR at a persistent volume.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Observation } from "./watch.js";

export interface State {
  nonce: number;
  observations: Record<string, Observation>;
  /** The targets the registry last confirmed as assigned here: the list kept when the assignment source is down. */
  targets?: string[];
}

export const stateDir = (env: Record<string, string | undefined> = process.env) => env.ARUNA_ATTESTOR_STATE_DIR?.trim() || join(homedir(), ".aruna-attestor");
const statePath = (attestor: string, dir: string) => join(dir, `${attestor}.json`);

export function loadState(attestor: string, dir: string = stateDir()): State {
  const p = statePath(attestor, dir);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { nonce: Date.now(), observations: {} };
}

export function saveState(attestor: string, s: State, dir: string = stateDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(statePath(attestor, dir), JSON.stringify(s, null, 2), { mode: 0o600 });
}
