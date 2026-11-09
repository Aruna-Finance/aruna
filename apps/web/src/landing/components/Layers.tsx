import { ArrowRight, X } from "@phosphor-icons/react/dist/ssr";

// Copy follows the prototype's "layers" section. The refusal list is the prototype's SIX list.
const CHECKS = [
  ["view_account", "how the code is referenced"],
  ["view_access_key_list", "whether a full-access key exists"],
  ["view_code", "the code that actually runs"],
] as const;

const REFUSED = [
  "Send NEAR",
  "Add a key",
  "Deploy code",
  "Call any contract except its vault",
  "Call any method off its list, including callbacks",
] as const;

const GREY = "text-[#9a9a9a]";

export function Layers() {
  return (
    <section id="layers" className="page scroll-mt-16 bg-wash py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">Three layers, starting with measurement</h2>
        <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-slate">
          The classifier works alone for any contract. The vault makes its answer actionable, and coverage prices
          what is left.
        </p>

        <div className="mt-12 grid border-y border-line-2 bg-paper lg:grid-cols-3 lg:divide-x lg:divide-line-2">
          <article className="flex flex-col gap-4 border-b border-line-2 p-6 md:p-8 lg:border-b-0">
            <p className="label text-xs text-muted">Layer 1</p>
            <h3 className="text-2xl">Measurement classifies and records</h3>
            <p className="leading-[1.5] text-slate">
              Four classes from public chain data, and a public record of what each agent sent where.
            </p>
            <ul className="mt-auto border border-line-2">
              {CHECKS.map(([call, what], i) => (
                <li key={call} className="border-b border-line-2 px-4 py-3 last:border-b-0">
                  <span className="mono block">{call}</span>
                  <span className="text-sm text-muted">{what}</span>
                </li>
              ))}
              <li className="flex items-center gap-2 bg-wash px-4 py-3 text-sm">
                <ArrowRight size={16} weight="regular" aria-hidden />
                four risk classes
              </li>
            </ul>
          </article>

          <article className="flex flex-col gap-4 border-b border-line-2 p-6 md:p-8 lg:border-b-0">
            <p className="label text-xs text-muted">Layer 2</p>
            <h3 className="text-2xl">Protection acts on the class</h3>
            <p className="leading-[1.5] text-slate">
              Each agent is one function-call key on a vault with no full-access key. These are refused by the
              protocol.
            </p>
            <ul className="mt-auto border border-line-2">
              {REFUSED.map((r) => (
                <li key={r} className="flex items-start gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-b-0">
                  <X size={16} weight="regular" aria-hidden className="mt-0.5 shrink-0 text-dawn-ink" />
                  {r}
                </li>
              ))}
            </ul>
          </article>

          <article className="flex flex-col gap-4 p-6 md:p-8">
            <p className="label text-xs text-muted">Layer 3</p>
            <h3 className="text-2xl">Coverage pays on code change</h3>
            <p className="leading-[1.5] text-slate">
              A parametric payout when a covered contract&apos;s implementation changes while the agent is
              exposed.
            </p>
            <pre
              aria-label="Payout formula with an example"
              className="mt-auto overflow-x-auto bg-ink p-5 font-mono text-[14px] leading-[1.8] whitespace-pre text-paper"
            >
              <span className={GREY}>example</span>
              {"\n"}min(exposure × ratio, limit)
              {"\n"}min(400 × 80%, 500)
              {"\n"}= 320 USDC
              {"\n"}
              <span className="text-dawn">Unknown targets are never priced.</span>
            </pre>
          </article>
        </div>
      </div>
    </section>
  );
}
