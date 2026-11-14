import { CLASS_LABEL } from "@/landing/lib/class-labels";

// Copy from the prototype's CLASS_INFO. `unknown` is never styled as safe: dashed frame, no price.
const CLASSES = [
  {
    id: "immutable_verified",
    title: CLASS_LABEL.immutable_verified,
    basis: "Code by hash, no full-access key, and none of the scanned imports in the WASM.",
    sure: "No detected upgrade path, and sticky",
    price: "Lowest premium",
  },
  {
    id: "local_upgradeable",
    title: CLASS_LABEL.local_upgradeable,
    basis: "The account's own code, or an upgrade path that cannot be ruled out.",
    sure: "Detected",
    price: "Base premium",
  },
  {
    id: "global_by_account",
    title: CLASS_LABEL.global_by_account,
    basis: "References a global contract another account can redeploy.",
    sure: "Detected through a separate channel",
    price: "Highest premium",
    finding: true,
  },
  {
    id: "unknown",
    title: CLASS_LABEL.unknown,
    basis: "Cannot be determined from the available data.",
    sure: "Not known",
    price: "Cannot be covered",
    unknown: true,
  },
] as const;

export function Classes() {
  return (
    <section id="classes" className="page scroll-mt-16 py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">Four risk classes, read from public chain data</h2>
        <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-slate">
          Anyone can rerun the three checks and get the same answer. What cannot be proved is written as unknown and
          never gets a price.
        </p>

        <ul className="mt-12 grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {CLASSES.map((c) => (
            <li
              key={c.id}
              className={`flex flex-col gap-4 bg-paper p-6 md:p-8 ${"finding" in c ? "border-t-[3px] border-dawn" : ""} ${
                "unknown" in c ? "outline outline-1 -outline-offset-8 outline-dashed outline-line-2" : ""
              }`}
            >
              <p className={`mono ${"finding" in c ? "text-dawn-ink" : ""}`}>{c.id}</p>
              <h3 className="text-2xl">{c.title}</h3>
              <p className="leading-[1.5] text-slate">{c.basis}</p>
              <dl className="mt-auto grid gap-3 border-t border-line-2 pt-4 text-sm">
                <div>
                  <dt className="label text-[11px] text-muted">Evidence</dt>
                  <dd>{c.sure}</dd>
                </div>
                <div>
                  <dt className="label text-[11px] text-muted">Price</dt>
                  <dd className="font-medium">{c.price}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-[80ch] border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
          <strong className="font-medium">A change most monitors miss.</strong> With global_by_account, the owner
          redeploys and the target&apos;s <code className="mono">view_account.code_hash</code> stays the same. Only{" "}
          <code className="mono">view_code</code> shows it. Aruna watches both, plus the owner&apos;s account.
        </p>
      </div>
    </section>
  );
}
