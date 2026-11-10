import type { CoverageStage } from "../data/coverage";

const FLOW: CoverageStage[] = ["WaitingPeriod", "CoverageActive", "ChallengeWindow", "PayoutExecuted"];

/** Where a coverage policy is in its life: waiting, active, challenge window, paid. */
export function StageBar({ stage }: { stage: CoverageStage }) {
  if (stage === "CoverageExpired") return <span className="text-sm text-muted">Expired</span>;
  const idx = FLOW.indexOf(stage);
  return (
    <div title={stage}>
      <div className="flex w-30 gap-0.5" aria-hidden>
        {FLOW.map((s, i) => (
          <i
            key={s}
            className={`block h-1.5 flex-1 ${i < idx ? "bg-ink" : i === idx ? (stage === "ChallengeWindow" ? "bg-dawn" : "bg-ink") : "bg-fog"}`}
          />
        ))}
      </div>
      <span className="mono text-xs whitespace-nowrap">{stage}</span>
    </div>
  );
}
