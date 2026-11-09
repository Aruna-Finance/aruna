import { Button } from "./Button";

const GREY = "text-[#9a9a9a]";

export function Sdk() {
  return (
    <section id="sdk" className="page scroll-mt-16 bg-wash py-16">
      <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
        <h2 className="max-w-[22ch] text-[clamp(30px,4.4vw,63px)]">A free check for any agent, with no account</h2>
        <p className="mt-6 max-w-[60ch] text-lg leading-[1.6] text-slate">
          Any agent can ask whether a contract can change before it touches it, through the SDK or MCP. Agents that
          want limits get a key on a vault.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="label mb-3 text-sm text-muted">Keyless: works for any NEAR contract</p>
            <pre className="overflow-x-auto bg-ink p-6 font-mono text-[14px] leading-[1.8] whitespace-pre text-paper">
              {'await mcp.call("aruna_check_target", {\n  account_id: "router.testnet",\n});\n'}
              <span className={GREY}>
                {'// class: "global_by_account"\n// reason: its owner can change this code\n// without any transaction touching it'}
              </span>
            </pre>
          </div>
          <div>
            <p className="label mb-3 text-sm text-muted">With a vault: the key can only reach the vault</p>
            <pre className="overflow-x-auto bg-ink p-6 font-mono text-[14px] leading-[1.8] whitespace-pre text-paper">
              {'const r = await vault.spend({\n  adapter: "dex",\n  tokenIn: "usdc.testnet",\n  amountIn: "50",\n  minAmountOut,\n});\n'}
              <span className={GREY}>{"// { ok: false, reason, targetClass } on a refusal"}</span>
            </pre>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-8">
          <a href="#developers" tabIndex={-1}>
            <Button type="button">Read the SDK reference</Button>
          </a>
          <a href="#playground" className="label underline underline-offset-4 hover:text-muted">
            Run the injected agent
          </a>
        </div>
      </div>
    </section>
  );
}
