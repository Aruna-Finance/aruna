const POINTS = [
  {
    title: "Agents act without a second look",
    text: "One instruction can become hundreds of transactions.",
  },
  {
    title: "Keys do not understand money",
    text: "A key cannot judge an amount or a daily total.",
  },
  {
    title: "Limits do not remove risk",
    text: "A whitelisted contract can still upgrade underneath.",
  },
] as const;

const GREY = "text-[#9a9a9a]";

export function Problem() {
  return (
    <section id="problem" className="page scroll-mt-16 py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <div className="grid items-start gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 className="text-[clamp(30px,4.4vw,63px)]">Access keys stop at who may be called</h2>
            <p className="mt-6 max-w-[40ch] text-lg leading-[1.6] text-slate">
              A key can name a contract and a method. It cannot judge whether the call makes sense.
            </p>
          </div>

          <div className="lg:col-span-7">
            <pre
              aria-label="The same swap checked by a key and by the gate"
              className="overflow-x-auto bg-ink p-6 font-mono text-[14px] leading-[1.9] whitespace-pre text-paper md:p-8 md:text-[15px]"
            >
              <span className={GREY}>agent key calls swap</span>
              {"\n"}amount_in       1,000 USDC
              {"\n"}min_amount_out      1 USDC
              {"\n\n"}
              <span className={GREY}>access key      </span>allowed
              {"\n"}
              <span className={GREY}>aruna vault     </span>
              <span className="text-dawn">ARUNA_MAX_PER_TX_EXCEEDED</span>
              {"\n"}
              <span className={GREY}>funds moved     </span>0 USDC
            </pre>

            <div className="mt-6 overflow-x-auto bg-paper">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="label border-y border-ink text-[13px] text-muted">
                    <th scope="col" className="px-4 py-3 font-medium">Layer</th>
                    <th scope="col" className="px-4 py-3 font-medium">Question it answers</th>
                    <th scope="col" className="px-4 py-3 font-medium">Enforced by</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line-2">
                    <th scope="row" className="px-4 py-4 font-medium">Access control</th>
                    <td className="px-4 py-4">May the agent make this call?</td>
                    <td className="mono px-4 py-4">NEAR protocol, cryptographically</td>
                  </tr>
                  <tr className="border-b border-ink">
                    <th scope="row" className="px-4 py-4 font-medium">Economic policy</th>
                    <td className="px-4 py-4">Does this call make sense?</td>
                    <td className="mono px-4 py-4 text-dawn-ink">nothing</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <ul className="mt-14 grid border-y border-line-2 bg-paper md:grid-cols-3 md:divide-x md:divide-line-2">
          {POINTS.map((p) => (
            <li key={p.title} className="border-b border-line-2 p-6 last:border-b-0 md:border-b-0 md:p-8">
              <h3 className="text-xl">{p.title}</h3>
              <p className="mt-3 max-w-[40ch] leading-[1.5] text-slate">{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
