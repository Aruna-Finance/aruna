import type { VaultView } from "@aruna/sdk";

// Totals for the vault overview, from what readVault already returns. Nothing here classifies a target (CLAUDE.md
// rule 10): the class shown is the one the vault recorded with the exposure, or none when nothing was sent there.

export interface TargetRow {
  target: string;
  /** NEAR sent to the target and settled, in yoctoNEAR. */
  exposure: bigint;
  /** The class recorded with the latest exposure, or null when nothing has been sent. */
  classAtRecord: string | null;
  /** Agents (not revoked) whose policy lists this target. */
  allowedBy: number;
  inCeiling: boolean;
}

export interface Overview {
  agentsActive: number;
  agentsTotal: number;
  exposureNear: bigint;
  targets: TargetRow[];
}

export function overviewOf(view: VaultView): Overview {
  const live = view.agents.filter((a) => a.status !== "Revoked");
  const exposure = view.exposure ?? [];
  const ids = new Set<string>(view.ceiling?.allowedTargets ?? []);
  live.forEach((a) => a.policy.allowedTargets.forEach((t) => ids.add(t)));
  exposure.forEach((e) => ids.add(e.target));
  const targets = [...ids].map((target) => {
    const rows = exposure.filter((e) => e.target === target);
    return {
      target,
      exposure: rows.reduce((s, r) => s + BigInt(r.amount), 0n),
      classAtRecord: rows.length ? rows[rows.length - 1].classAtRecord : null,
      allowedBy: live.filter((a) => a.policy.allowedTargets.includes(target)).length,
      inCeiling: view.ceiling?.allowedTargets.includes(target) ?? false,
    };
  });
  return {
    agentsActive: view.agents.filter((a) => a.status === "Active").length,
    agentsTotal: live.length,
    exposureNear: targets.reduce((s, t) => s + t.exposure, 0n),
    targets,
  };
}
