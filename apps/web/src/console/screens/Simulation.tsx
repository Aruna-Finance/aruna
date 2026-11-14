import { MEASURES, SIM, eventText, peopleText, rulesText, withdrawalText, type SimScenario } from "../data/simulation-published";
import { Panel } from "../ui/Panel";

const th = "border-b border-line-2 px-3 py-3 text-left align-bottom font-medium";
const td = "border-b border-line px-3 py-3 align-top text-sm";
const BREAK_CELL = "border-l-[3px] border-l-dawn bg-dawn-wash";

const holds = SIM.scenarios.filter((s) => !s.breaksThePool);
const breaks = SIM.scenarios.filter((s) => s.breaksThePool);
const ordered: SimScenario[] = [...holds, ...breaks];

export function Simulation() {
  const pEvent = SIM.pEventBps30d;
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Stress test</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Published results of the project&apos;s pool simulation (<span className="mono">{SIM.generatedFrom}</span>, run on {SIM.date}). Every number
        below follows from the assumptions on this page. None is measured.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Assumptions" aside={<span className="text-sm text-muted">All of these are assumptions</span>}>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Size of the runs</dt>
              <dd>{peopleText()}</dd>
            </div>
            <div>
              <dt className="text-muted">Assumed chance a contract changes, per 30 days</dt>
              <dd>
                <strong className="font-medium">Underwriting assumption, not a measurement.</strong> The pool&apos;s own declared values: immutable{" "}
                {pEvent.immutable_verified / 100}%, local upgradeable {pEvent.local_upgradeable / 100}%, global by account {pEvent.global_by_account / 100}%.
              </dd>
            </div>
            <div>
              <dt className="text-muted">Pool rules</dt>
              <dd>
                Capital adequacy k = {Number(SIM.poolParams.kX100) / 100}, concentration limit {Number(SIM.poolParams.concentrationBps) / 10000} x capital, as
                the contract declares them.
              </dd>
            </div>
            <div>
              <dt className="text-muted">What the model leaves out</dt>
              <dd>Disputes and the arbiter, a wrong or late attestor, several underwriters, several tokens, and agents changing behaviour after a loss.</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            The full input of each scenario is in <span className="mono">{SIM.generatedFrom}/assumptions.json</span>, and the method in{" "}
            <span className="mono">REPORT.md</span> beside it.
          </p>
        </Panel>

        <Panel title="One table, six scenarios" aside={<span className="text-sm text-muted">{SIM.runsPerScenario.toLocaleString("en-US")} runs each</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Measure</th>
                  {ordered.map((s) => (
                    <th key={s.id} className={`${th} ${s.breaksThePool ? BREAK_CELL : ""}`}>
                      {s.title}
                      {s.breaksThePool && <span className="mt-1 block text-xs font-normal text-dawn-ink">The scenario that breaks the pool</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className={`${td} text-left font-medium`}>
                    Starting capital, NEAR
                  </th>
                  {ordered.map((s) => (
                    <td key={s.id} className={`${td} mono ${s.breaksThePool ? BREAK_CELL : ""}`}>
                      {s.startingCapitalNear.toLocaleString("en-US")}
                    </td>
                  ))}
                </tr>
                {MEASURES.map((m) => (
                  <tr key={m.label}>
                    <th scope="row" className={`${td} text-left font-medium`}>
                      {m.label}
                    </th>
                    {ordered.map((s) => (
                      <td key={s.id} className={`${td} mono ${s.breaksThePool ? BREAK_CELL : ""}`}>
                        {m.value(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-muted">
            &quot;Insolvent&quot; means the pool refused at least one claim because it was larger than the book&apos;s capital. A solvent scenario says
            only that it was not insolvent within {SIM.days} days.
          </p>
        </Panel>

        {breaks.map((s) => (
          <p key={s.id} className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
            <strong className="font-medium">The pool breaks in this scenario.</strong> {s.note} It breaks in {(s.pInsolvency.p * 100).toFixed(0)}% of runs,
            a median of {s.timeToInsolvencyDays.median} days in. It is shown as it happened.
          </p>
        ))}

        <Panel title="What each scenario does">
          <dl className="grid gap-4 text-sm">
            {ordered.map((s) => (
              <div key={s.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <dt className="font-medium">
                  {s.title}
                </dt>
                <dd className="mt-1 max-w-[90ch] leading-[1.6] text-slate">{s.note}</dd>
                <dd className="mono mt-1 text-xs text-muted">
                  scripted event: {eventText(s)}. underwriter withdrawal: {withdrawalText(s)}. pool rules: {rulesText(s)}.
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </article>
  );
}
