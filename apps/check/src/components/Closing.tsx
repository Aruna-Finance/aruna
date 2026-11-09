import Link from "next/link";
import { Button } from "./Button";

const LINKS = [
  { href: "/spec/", label: "Spec" },
  { href: "/proof/", label: "Lab results" },
  { href: "#developers", label: "SDK and MCP" },
  { href: "#simulation", label: "Simulation" },
] as const;

export function Closing() {
  return (
    <footer id="trust" className="bg-ink text-paper">
      <div className="page mx-auto w-full max-w-[1440px] px-5 py-16 md:px-16">
        <div className="my-auto">
          <h2 className="max-w-[20ch] text-[clamp(30px,4.4vw,63px)]">
            Measured first, then bounded and partly transferable
          </h2>
          <p className="mt-6 max-w-[62ch] text-lg leading-[1.6] text-[#bdbdbd]">
            Aruna does not make agents smarter and does not repay every loss. Two parties must be trusted: the
            attestor, permanently, and at this stage a dispute arbiter. The spec names them and every other limit.
          </p>
          <a href="#check" tabIndex={-1} className="mt-10 inline-block">
            <Button type="button">Open the demo</Button>
          </a>
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/20 pt-8">
          {/* The logo art is dark on white; invert and lighten-blend it onto the dark footer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="Aruna" width={40} height={40} className="size-10 mix-blend-lighten invert" />
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label text-sm hover:text-[#bdbdbd]">
              {l.label}
            </Link>
          ))}
          <span className="label ml-auto text-xs text-[#9a9a9a]">Testnet only. Prototype with simulated data.</span>
        </div>
      </div>
    </footer>
  );
}
