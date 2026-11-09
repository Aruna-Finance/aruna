import type { ReactNode } from "react";
import Link from "next/link";
import { Navbar } from "./Navbar";

export type TocItem = { id: string; label: string };

/** Shared frame for the Spec and Lab results pages: navbar, title, sticky contents, footer strip. */
export function DocShell({
  title,
  intro,
  toc,
  other,
  children,
}: {
  title: string;
  intro: ReactNode;
  toc: TocItem[];
  other: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main id="top">
        <header className="border-b border-line-2 py-16">
          <div className="mx-auto w-full max-w-[1440px] px-5 md:px-16">
            <h1 className="max-w-[18ch] text-[clamp(36px,6vw,74px)]">{title}</h1>
            <div className="mt-6 max-w-[62ch] text-lg leading-[1.6] text-slate">{intro}</div>
          </div>
        </header>
        <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-5 py-12 md:px-16 lg:grid-cols-12">
          <nav aria-label="On this page" className="lg:col-span-3">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 lg:sticky lg:top-24 lg:flex-col lg:gap-y-3">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="label text-sm hover:text-muted">
                    {t.label}
                  </a>
                </li>
              ))}
              <li className="lg:mt-4">
                <Link href={other.href} className="label text-sm underline underline-offset-4 hover:text-muted">
                  {other.label}
                </Link>
              </li>
            </ul>
          </nav>
          <div className="grid gap-16 lg:col-span-9">{children}</div>
        </div>
      </main>
      <footer className="border-t border-line-2 bg-fog">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-8 md:px-16">
          <Link href="/" className="label text-sm hover:text-muted">Home</Link>
          <Link href="/spec/" className="label text-sm hover:text-muted">Spec</Link>
          <Link href="/proof/" className="label text-sm hover:text-muted">Lab results</Link>
          <span className="label ml-auto text-xs text-muted">Testnet only. Prototype with simulated data.</span>
        </div>
      </footer>
    </>
  );
}

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-[clamp(26px,3.2vw,40px)]">{title}</h2>
      {lead && <div className="mt-4 max-w-[66ch] leading-[1.6] text-slate">{lead}</div>}
      <div className="mt-8 grid gap-6">{children}</div>
    </section>
  );
}

export function DocTable({
  caption,
  head,
  rows,
  mono = [],
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
  /** column indexes rendered in the mono face (error strings, identifiers) */
  mono?: number[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="label border-y border-ink text-[12px] text-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line-2 align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-3 ${mono.includes(j) ? "mono" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[80ch] border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">{children}</p>
  );
}
