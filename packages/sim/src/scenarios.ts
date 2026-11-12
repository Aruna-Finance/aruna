// The five scenarios of docs/BUILD-PLAN.md stage 8 (plan R41), as overrides of the basis case, plus one
// labelled counterfactual. Each carries its full `Assumptions`, so a result file lists every input it used.
import { baseAssumptions, type Assumptions } from "./model.js";

export type ScenarioId = "normal" | "single_target_changes" | "correlated_mass_claims" | "underwriter_withdrawal" | "insufficient_capital";

export interface Scenario {
  id: ScenarioId | "underwriter_withdrawal_without_lock";
  title: string;
  note: string;
  /** True for the scenario that is meant to break the pool, and is shown as it is. */
  breaksThePool?: boolean;
  /** True for a run that is not the contract: it switches a rule off to show what the rule is for. */
  counterfactual?: boolean;
  assumptions: Assumptions;
}

const with_ = (over: (a: Assumptions) => void): Assumptions => {
  const a = baseAssumptions();
  over(a);
  return a;
};

export function scenarios(): Scenario[] {
  const withdrawal = { day: 25, shareBps: 5_000 };
  const midEvent = [{ day: 40, kind: "most_exposed_implementation" as const }];
  return [
    { id: "normal", title: "Normal operation", note: "Independent, infrequent code changes, at the pool's own declared P(event). No scripted event.", assumptions: baseAssumptions() },
    {
      id: "single_target_changes",
      title: "One target changes",
      note: "On top of the random changes, the implementation with the most coverage on it changes on day 20.",
      assumptions: with_((a) => (a.events.scripted = [{ day: 20, kind: "most_exposed_implementation" }])),
    },
    {
      id: "correlated_mass_claims",
      title: "Mass correlated claims",
      note: "On day 30 the upgrade authority with the most coverage behind it changes everything it controls at once, and every exposed agent claims within two hours of the report becoming claimable.",
      assumptions: with_((a) => {
        a.events.scripted = [{ day: 30, kind: "most_concentrated_authority" }];
        a.claims.claimDelayMaxBlocks = 3_600;
      }),
    },
    {
      id: "underwriter_withdrawal",
      title: "Underwriter withdrawal",
      note: "On day 25 the underwriter tries to withdraw half its shares, daily until it works; on day 40 a mid-sized change lands. The contract refuses withdrawals while any coverage is open or in its reporting period.",
      assumptions: with_((a) => {
        a.underwriter.withdrawal = withdrawal;
        a.events.scripted = midEvent;
      }),
    },
    {
      id: "underwriter_withdrawal_without_lock",
      title: "Underwriter withdrawal, lock switched off (counterfactual, not the contract)",
      note: "The same run with the contract's withdrawal lock removed, to show what the lock protects. The contract does not behave like this.",
      counterfactual: true,
      assumptions: with_((a) => {
        a.underwriter.withdrawal = withdrawal;
        a.events.scripted = midEvent;
        a.pool.book = { lockEnforced: false };
      }),
    },
    {
      id: "insufficient_capital",
      title: "Capital not enough",
      note: "The pool starts with 100 NEAR, with no adequacy rule and no concentration limit, against all the coverage the agents want to buy. On day 30 the upgrade authority with the most coverage behind it changes everything it controls, and every exposed agent claims within two hours. This is the scenario that breaks the pool.",
      breaksThePool: true,
      assumptions: with_((a) => {
        a.pool.startingCapitalNear = 100;
        a.pool.book = { adequacy: false, concentration: false };
        a.events.scripted = [{ day: 30, kind: "most_concentrated_authority" }];
        a.claims.claimDelayMaxBlocks = 3_600;
      }),
    },
  ];
}
