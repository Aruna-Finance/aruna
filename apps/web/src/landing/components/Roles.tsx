import { Check, X } from "@phosphor-icons/react/dist/ssr";

type Item = { text: string; ok: boolean };

// Copy from the prototype's roles section. Fragments use its refusal vocabulary, no simulated numbers.
const ROLES: { title: string; text: string; items: Item[]; foot?: string }[] = [
  {
    title: "Client",
    text: "Owns the vault, sets the ceiling, withdraws, and can remove the operator at any time.",
    items: [
      { text: "Set the ceiling", ok: true },
      { text: "Withdraw funds", ok: true },
      { text: "Remove the operator", ok: true },
    ],
  },
  {
    title: "Operator",
    text: "Adds agents within the ceiling, pauses and tightens. It cannot loosen limits or withdraw.",
    items: [
      { text: "Add agents, pause, tighten", ok: true },
      { text: "Loosen a limit", ok: false },
      { text: "Resume an agent", ok: false },
      { text: "Withdraw funds", ok: false },
    ],
  },
  {
    title: "Anyone checking",
    text: "Reads what an agent cannot do with no login, then verifies it with one command.",
    items: [
      { text: "Send NEAR", ok: false },
      { text: "Add a key", ok: false },
    ],
    foot: "No login needed.",
  },
  {
    title: "Underwriter, on testnet",
    text: "Watches how much of a pool rests on one implementation, before real capital is at risk.",
    items: [
      { text: "Read pool concentration", ok: true },
      { text: "Watch each implementation", ok: true },
    ],
  },
];

export function Roles() {
  return (
    <section id="roles" className="page scroll-mt-16 py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">Built for companies that run agents for clients</h2>
        <p className="mt-6 max-w-[62ch] text-lg leading-[1.6] text-slate">
          One vault per client. The client holds the funds and sets the ceiling, and the company runs the agents and
          cannot take the money. One URL shows the client what is enforced.
        </p>

        <ul className="mt-12 grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <li key={r.title} className="flex flex-col gap-4 bg-paper p-6 md:p-8">
              <h3 className="text-2xl">{r.title}</h3>
              <p className="leading-[1.5] text-slate">{r.text}</p>
              <ul className="mt-auto border-t border-line-2 pt-4 text-sm">
                {r.items.map((i) => (
                  <li key={i.text} className="flex items-start gap-3 py-1.5">
                    {i.ok ? (
                      <Check size={16} weight="regular" aria-label="allowed" className="mt-0.5 shrink-0" />
                    ) : (
                      <X size={16} weight="regular" aria-label="refused" className="mt-0.5 shrink-0 text-dawn-ink" />
                    )}
                    {i.text}
                  </li>
                ))}
              </ul>
              {r.foot && <p className="mono text-xs text-muted">{r.foot}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
