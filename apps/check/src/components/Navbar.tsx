import { Button } from "./Button";

const LINKS = [
  { href: "#check", label: "Classifier" },
  { href: "#classes", label: "Risk classes" },
  { href: "#hero", label: "Vault" },
  { href: "#pricing", label: "Coverage" },
  { href: "#trust", label: "Spec" },
] as const;

export function Navbar() {
  return (
    <nav aria-label="Main" className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-5 py-2 md:px-16">
        <a href="#top" aria-label="Aruna">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" width={48} height={48} className="size-12" />
        </a>
        <ul className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="label text-sm transition-colors hover:text-muted">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <a href="#check" tabIndex={-1}>
          <Button type="button" className="px-4 py-2.5 text-sm">
            Open the demo
          </Button>
        </a>
      </div>
    </nav>
  );
}
