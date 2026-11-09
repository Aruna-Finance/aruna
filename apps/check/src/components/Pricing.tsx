"use client";
import { useState } from "react";
import Link from "next/link";
import { premium, type PricedClass } from "@/lib/premium-model";

const REACH: { value: PricedClass; label: string }[] = [
  { value: "immutable_verified", label: "immutable only" },
  { value: "local_upgradeable", label: "+ local upgradeable" },
  { value: "global_by_account", label: "+ global by account" },
  { value: "unknown", label: "+ unknown" },
];
const PRICE_ROW: PricedClass[] = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"];

const money = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function Pricing() {
  const [slip, setSlip] = useState(0.5);
  const [cap, setCap] = useState(100);
  const [cls, setCls] = useState<PricedClass>("local_upgradeable");
  const r = premium(cls, cap, slip);

  return (
    <section id="pricing" className="page scroll-mt-16 bg-wash py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">A tighter policy costs less to cover</h2>
        <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-slate">
          The premium comes from the most the policy still allows, so narrowing an agent&apos;s authority lowers its
          price.
        </p>

        <div className="mt-12 grid gap-px border border-line-2 bg-line-2 lg:grid-cols-12">
          <div className="grid gap-8 bg-paper p-6 md:p-8 lg:col-span-7">
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label htmlFor="slip" className="font-medium">Max slippage</label>
                <span className="mono">{slip.toFixed(1)}%</span>
              </div>
              <input
                id="slip"
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={slip}
                onChange={(e) => setSlip(parseFloat(e.target.value))}
                aria-valuetext={`${slip.toFixed(1)} percent`}
                className="mt-3 w-full cursor-pointer accent-ink"
              />
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label htmlFor="cap" className="font-medium">Daily cap</label>
                <span className="mono">{money(cap)} USDC</span>
              </div>
              <input
                id="cap"
                type="range"
                min={10}
                max={2000}
                step={10}
                value={cap}
                onChange={(e) => setCap(parseFloat(e.target.value))}
                aria-valuetext={`${money(cap)} USDC`}
                className="mt-3 w-full cursor-pointer accent-ink"
              />
            </div>
            <fieldset>
              <legend className="font-medium">Classes the agent may touch</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {REACH.map((o) => (
                  <label
                    key={o.value}
                    className="label cursor-pointer border border-line-2 px-3 py-2.5 text-sm transition-colors has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink hover:border-ink"
                  >
                    <input
                      type="radio"
                      name="classes"
                      value={o.value}
                      checked={cls === o.value}
                      onChange={() => setCls(o.value)}
                      className="sr-only"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-col justify-between gap-8 bg-ink p-6 text-paper md:p-8 lg:col-span-5">
            <p className="flex items-baseline justify-between gap-4 border-b border-white/20 pb-4">
              <span>Max <span className="mono">30</span>-day exposure</span>
              <span className="mono text-lg">{money(r.maxExposure)} USDC</span>
            </p>
            <div aria-live="polite" aria-atomic="true">
              <p className="label text-sm text-[#bdbdbd]">
                Premium <Link href="/spec/#assumptions" className="ml-2 border border-white/40 px-1.5 py-0.5 text-[11px] hover:border-white">assumption</Link>
              </p>
              {r.priced ? (
                <>
                  <p className="mono mt-3 text-[clamp(40px,6vw,72px)] leading-none">
                    {money(r.total, 2)}
                    <small className="text-[0.35em] text-[#bdbdbd]"> USDC</small>
                  </p>
                  <p className="mt-4 text-sm text-[#bdbdbd]">
                    <span className="mono">{r.pctOfExposure.toFixed(1)}%</span> of maximum exposure,{" "}
                    <span className="mono">30</span> days, parametric, implementation change only
                  </p>
                </>
              ) : (
                <>
                  <p className="mono mt-3 text-[clamp(32px,5vw,56px)] leading-none text-dawn">not priced</p>
                  <p className="mt-4 text-sm text-[#bdbdbd]">
                    Mutability cannot be proved for every target in this set. A risk product that prints a number
                    here is wrong on the first event.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="mt-8 mb-3 text-sm text-muted">
          30-day premium by riskiest class, at a 100 USDC daily cap and 0.5% slippage
        </p>
        <ul className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRICE_ROW.map((c) => {
            const q = premium(c, 100, 0.5);
            return (
              <li key={c} className="bg-paper p-5">
                <p className="mono text-xs text-muted">{c}</p>
                <p className={`mt-2 text-xl ${q.priced ? "" : "text-dawn-ink"}`}>
                  {q.priced ? `${money(q.total, 2)} USDC` : "Not priced"}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 max-w-[70ch] text-sm text-muted">
          Illustrative model. Event probabilities, capital cost and margins are underwriting assumptions from the
          prototype, not measurements. Premium = expected loss + capital cost + operations + risk margin.
        </p>
      </div>
    </section>
  );
}
