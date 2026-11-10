"use client";

import { useMemo, useState } from "react";
import { COVERAGE_ASSUME, DAY } from "../data/coverage";
import { SCENARIOS, SIM_ASSUME, simulate, simulateMany, type DayPoint, type ScenarioId } from "../data/simulation";
import { n0 } from "../fmt";
import { NumberField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { TokenIcon } from "../ui/Token";

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const IDS = Object.keys(SCENARIOS) as ScenarioId[];

function Chart({ series, breakDay }: { series: DayPoint[]; breakDay: number | null }) {
  const W = 640;
  const H = 260;
  const m = { l: 56, r: 12, t: 12, b: 28 };
  const max = Math.max(1, ...series.map((s) => Math.max(s.capital, s.required))) * 1.05;
  const x = (day: number) => m.l + ((day - 1) / (series.length - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b);
  const line = (f: (s: DayPoint) => number) => series.map((s, i) => `${i ? "L" : "M"}${x(s.day).toFixed(1)},${y(f(s)).toFixed(1)}`).join(" ");
  const ticks = [1, 15, 30, 45, 60].filter((d) => d <= series.length);
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Pool capital over ${series.length} days, from ${n0(first.capital)} to ${n0(last.capital)} USDC. The data table below has every value.`}
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={m.l} x2={W - m.r} y1={y(max * f)} y2={y(max * f)} className="stroke-line-2" strokeWidth={1} />
          <text x={m.l - 8} y={y(max * f) + 4} textAnchor="end" className="fill-muted text-[11px]">
            {n0(max * f)}
          </text>
        </g>
      ))}
      {ticks.map((d) => (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
          {d}
        </text>
      ))}
      {breakDay != null && (
        <g>
          <line x1={x(breakDay + 1)} x2={x(breakDay + 1)} y1={m.t} y2={H - m.b} className="stroke-dawn-ink" strokeWidth={1.5} strokeDasharray="3 3" />
          <text x={x(breakDay + 1) + 6} y={m.t + 12} className="fill-dawn-ink text-[11px]">
            first unpaid claim, day {breakDay + 1}
          </text>
        </g>
      )}
      <path d={line((s) => s.required)} fill="none" className="stroke-dawn" strokeWidth={2} strokeDasharray="6 4" />
      <path d={line((s) => s.capital)} fill="none" className="stroke-ink" strokeWidth={2.5} />
    </svg>
  );
}

export function Simulation() {
  const [id, setId] = useState<ScenarioId>("correlated");
  const [capital, setCapital] = useState<number>(SCENARIOS.correlated.capital);
  const sc = SCENARIOS[id];
  const override = capital > 0 ? { capital } : {};

  const r = useMemo(() => simulate(id, 42, override), [id, capital]); // eslint-disable-line react-hooks/exhaustive-deps
  const many = useMemo(() => simulateMany(id, 200, override), [id, capital]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(next: ScenarioId) {
    setId(next);
    setCapital(SCENARIOS[next].capital);
  }

  const assumptions: [string, string][] = [
    ["Agents, duration", `${SIM_ASSUME.agents} agents, ${SIM_ASSUME.days} days`],
    ["Starting capital", `${n0(capital || sc.capital)} USDC`],
    ["Independent event rate", `${(sc.dailyEventRate * 100).toFixed(1)}% per implementation, per day`],
    ["Correlated event", sc.massEvent ? `Day ${sc.massEvent.day}, ${Math.round(Math.min(1, sc.massEvent.share * 2) * 100)}% of the largest group` : "None"],
    ["Severity", "Exposure 40 to 100% of limit, 80% payout, capped at limit"],
    ["Premium rate", `${(SIM_ASSUME.premiumRatePer30d * 100).toFixed(1)}% of limit per 30 days`],
    ["Payout delay", `${COVERAGE_ASSUME.challengeWindowSec / DAY} days, the challenge window`],
    ["Exposure distribution", `Log-normal around ${SIM_ASSUME.exposureMedian} USDC`],
    ["Target concentration", `${SIM_ASSUME.implementations} implementations, skewed to the first few`],
    [
      "Pool rules",
      sc.rulesOff
        ? "Off: no adequacy rule or concentration limit"
        : `On: k = ${COVERAGE_ASSUME.capitalAdequacyK}, ${pct(COVERAGE_ASSUME.concentrationPct, 0)} per implementation`,
    ],
    ["Underwriter withdrawal", sc.withdrawal ? `Day ${sc.withdrawal.day}, ${Math.round(sc.withdrawal.share * 100)}% of free capital` : "None"],
  ];

  const tiles: { label: string; value: string; unit?: string; sub?: string }[] = [
    { label: "Final capital", value: n0(r.finalCapital), unit: "USDC" },
    { label: "Claims paid, unpaid", value: n0(r.paid), unit: `/ ${n0(r.unpaid)} USDC` },
    { label: "Max drawdown", value: pct(r.maxDrawdown) },
    {
      label: "Chance of insolvency",
      value: pct(many.pInsolvent, 0),
      unit: many.medianDay ? `, median day ${many.medianDay}` : undefined,
      sub: `200 runs. Solvency ratio ${Number.isFinite(r.solvency) ? r.solvency.toFixed(2) : "n/a"}`,
    },
  ];

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Where the pool holds and where it breaks</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Runs in your browser, on the assumptions listed below. This is a prototype of the model, not a result from the project&apos;s
        simulation in <span className="mono">sim/</span>, which does not exist yet.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <div className="flex flex-wrap gap-px border border-line-2 bg-line-2 sm:w-fit" role="group" aria-label="Scenario">
          {IDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === id}
              onClick={() => pick(k)}
              className={`label cursor-pointer px-4 py-2.5 text-xs ${k === id ? "bg-ink text-paper" : "bg-paper"}`}
            >
              {SCENARIOS[k].title}
            </button>
          ))}
        </div>

        {r.unpaid > 0 && (
          <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
            <strong className="font-medium">The pool breaks in this scenario.</strong> {n0(r.unpaid)} USDC of approved claims go unpaid
            from day {r.insolventDay! + 1}. It is shown as it happens.
          </p>
        )}

        <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="bg-paper p-6">
              <dt className="text-sm text-muted">{t.label}</dt>
              <dd className="mt-2 text-[28px] leading-none">
                {t.value}
                {t.unit && <small className="ml-1 text-base text-muted">{t.unit}</small>}
              </dd>
              {t.sub && <p className="mt-2 text-sm text-muted">{t.sub}</p>}
            </div>
          ))}
        </dl>

        <Panel title={`Capital over ${SIM_ASSUME.days} days, in USDC`}>
          <p className="mb-4 max-w-[80ch] text-sm text-slate">{sc.note}</p>
          <Chart series={r.series} breakDay={r.insolventDay} />
          <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <span>
              <i className="mr-2 inline-block h-0.5 w-6 bg-ink align-middle" aria-hidden />
              Pool capital
            </span>
            <span>
              <i className="mr-2 inline-block h-0.5 w-6 border-t-2 border-dashed border-dawn align-middle" aria-hidden />
              Required at k = {COVERAGE_ASSUME.capitalAdequacyK}
            </span>
            <span>Day of the {SIM_ASSUME.days}-day run on the horizontal axis</span>
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm">See the data table</summary>
            <div className="mt-3 max-h-60 overflow-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr>
                    {["Day", "Capital", "Required", "Paid", "Unpaid"].map((h, i) => (
                      <th key={h} className={`border-b border-line-2 px-3 py-2 font-medium whitespace-nowrap ${i ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.series
                    .filter((s) => s.day === 1 || s.day % 5 === 0)
                    .map((s) => (
                      <tr key={s.day}>
                        <td className="mono border-b border-line px-3 py-2">{s.day}</td>
                        <td className="mono border-b border-line px-3 py-2 text-right">{n0(s.capital)}</td>
                        <td className="mono border-b border-line px-3 py-2 text-right">{n0(s.required)}</td>
                        <td className="mono border-b border-line px-3 py-2 text-right">{n0(s.paid)}</td>
                        <td className="mono border-b border-line px-3 py-2 text-right">{n0(s.unpaid)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>

        <Panel title="Input assumptions" aside={<span className="text-sm text-muted">All of these are assumptions</span>}>
          <div className="mb-6 max-w-sm">
            <NumberField label="Starting capital" suffix={<TokenIcon t="USDC" />} min={1} step={1000} value={capital} onChange={setCapital} />
          </div>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {assumptions.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-muted">Policies accepted, turned away by the rules</dt>
              <dd>
                {r.policies}, {r.turnedAway}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </article>
  );
}
