import { Navbar } from "@/landing/components/Navbar";
import { Classes } from "@/landing/components/Classes";
import { Roles } from "@/landing/components/Roles";
import { Closing } from "@/landing/components/Closing";
import { VaultStage } from "@/landing/components/VaultStage";
import { CheckBox } from "@/landing/components/CheckBox";

export default function Page() {
  return (
    <>
      <Navbar home />
      <main id="top">
        <section id="check" className="lines page scroll-mt-16 py-16">
          <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
            <p className="label mb-9 text-base tracking-[1.92px]">NEAR testnet</p>
            <h1 className="max-w-[20ch] text-[clamp(36px,6vw,74px)]">
              Spending limits and coverage for money your AI agents hold.
            </h1>
            <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-slate">
              One vault per client. Agents can only send where and as much as the client allows. Contracts that can change
              under them are flagged, and coverage can pay out if they do.
            </p>
            <h2 className="mt-14 text-[clamp(20px,2vw,26px)]">Free check: can this contract still change under your agent?</h2>
            <p className="mt-2 max-w-[62ch] text-[15px] leading-[1.6] text-slate">
              Paste a NEAR account. Some contracts change with no transaction touching them, and most monitors miss it.
            </p>
            <CheckBox />
            <p className="label mt-8 text-sm text-muted">No wallet needed. Read from public chain data.</p>
          </div>
        </section>
        <section id="hero" className="page scroll-mt-16 bg-ink py-16 text-paper">
          <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
            <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">
              Each agent gets one key. The vault <span className="text-dawn">checks</span> every call.
            </h2>
            <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-line-2">
              Before any money moves, the vault checks the call against the client&apos;s limits and the contract&apos;s risk.
              Every amount sent is recorded on-chain.
            </p>
          </div>
          <div className="mx-auto mt-12 w-full max-w-[1440px] overflow-x-auto px-5 md:px-16">
            <p className="label mb-4 text-xs text-line-2">Example</p>
            <div className="min-w-[900px]">
              <VaultStage />
            </div>
          </div>
        </section>
        <Classes />
        <Roles />
      </main>
      <Closing />
    </>
  );
}
