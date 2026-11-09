import { Navbar } from "@/components/Navbar";
import { Classes } from "@/components/Classes";
import { Pricing } from "@/components/Pricing";
import { Roles } from "@/components/Roles";
import { Sdk } from "@/components/Sdk";
import { Closing } from "@/components/Closing";
import { Layers } from "@/components/Layers";
import { Problem } from "@/components/Problem";
import { VaultStage } from "@/components/VaultStage";
import { CheckBox } from "@/components/CheckBox";

export default function Page() {
  return (
    <>
      <Navbar home />
      <main id="top">
        <section id="check" className="lines page scroll-mt-16 py-16">
          <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
            <p className="label mb-9 text-base tracking-[1.92px]">Contract mutability check</p>
            <h1 className="max-w-[16ch] text-[clamp(36px,6vw,74px)]">
              Can this NEAR contract still change under your agent?
            </h1>
            <p className="mt-6 max-w-[56ch] text-lg leading-[1.6] text-slate">
              Aruna found a class of contract that can change with no transaction touching it,
              while the field everyone monitors never changes. Paste an account to see its class
              and the evidence.
            </p>
            <CheckBox />
            <p className="label mt-8 text-sm text-muted">
              No wallet. No backend. Reproducible from public RPC.
            </p>
          </div>
        </section>
        <section id="hero" className="page scroll-mt-16 bg-ink py-16 text-paper">
          <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
            <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">
              A vault acts on the <span className="text-dawn">class</span>, then prices what is left.
            </h2>
            <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-line-2">
              Each agent is one key on the vault. Every call is checked against the target&apos;s
              recorded class and the owner&apos;s limits, and every exposure is published on-chain.
            </p>
          </div>
          <div className="mx-auto mt-12 w-full max-w-[1440px] overflow-x-auto px-5 md:px-16">
            <div className="min-w-[900px]">
              <VaultStage />
            </div>
          </div>
        </section>
        <Problem />
        <Layers />
        <Classes />
        <Pricing />
        <Roles />
        <Sdk />
      </main>
      <Closing />
    </>
  );
}
