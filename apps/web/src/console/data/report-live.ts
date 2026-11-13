import type { ReportRow } from "./claims-live";

// Where a drift report is in the registry's own life, for the report page. The registry derives the state: a report is
// pending until the challenge window has passed since it was reported, then verified, unless a conflicting report disputed it.

/** Mirrors aruna_common::params::CHALLENGE_WINDOW_BLOCKS; a test keeps the two equal. */
export const CHALLENGE_WINDOW_BLOCKS = 300;

export type StepState = "done" | "now" | "bad" | "";
export interface Step {
  name: string;
  text: string;
  state: StepState;
}

export const STATE_TEXT: Record<string, string> = {
  pending: "Challenge window open",
  verified: "Verified",
  disputed: "Disputed",
  rejected: "Rejected",
};

/** Blocks left in the challenge window at a head block; zero or less once it has closed. */
export const windowBlocksLeft = (r: Pick<ReportRow, "reportedAtBlock">, head: number) => r.reportedAtBlock + CHALLENGE_WINDOW_BLOCKS - head;

export function timelineOf(r: ReportRow, head: number): Step[] {
  const left = windowBlocksLeft(r, head);
  const steps: Step[] = [
    { name: "drift_reported", text: `Reported by ${r.attestor}, who observed it at block ${r.observedAtBlock.toLocaleString("en-US")}. The code changed at block ${r.changedAtBlock.toLocaleString("en-US")}.`, state: "done" },
  ];
  steps.push(
    r.state === "pending"
      ? { name: "challenge_window", text: `${Math.max(left, 0).toLocaleString("en-US")} blocks left of ${CHALLENGE_WINDOW_BLOCKS}. A second bonded attestor may send a conflicting report, which opens a dispute.`, state: "now" }
      : r.state === "disputed"
        ? { name: "challenge_window", text: `A conflicting report${r.disputedBy !== null ? ` (report ${r.disputedBy})` : ""} opened a dispute. No claim pays until the arbiter rules.`, state: "bad" }
        : r.state === "rejected"
          ? { name: "challenge_window", text: "The arbiter ruled against this report.", state: "bad" }
          : { name: "challenge_window", text: `Closed after ${CHALLENGE_WINDOW_BLOCKS} blocks with no conflicting report, or by the arbiter's ruling for this report.`, state: "done" },
  );
  steps.push(
    r.state === "verified"
      ? { name: "claims_open", text: "A claim on a covered vault is checked by the pool when it is sent, and pays only if every condition holds.", state: "done" }
      : { name: "claims_open", text: r.state === "rejected" ? "No claim can use this report." : "A claim on this report is refused until it is verified.", state: r.state === "rejected" ? "bad" : "" },
  );
  return steps;
}
