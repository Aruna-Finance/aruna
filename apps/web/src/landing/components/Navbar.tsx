import Link from "next/link";
import { Button } from "@/shared/Button";

const LINKS = [
  { id: "check", label: "Classifier" },
  { id: "classes", label: "Risk classes" },
  { id: "hero", label: "Vault" },
  { id: "pricing", label: "Coverage" },
] as const;

/** On the landing page links are in-page anchors (smooth scroll); elsewhere they go back to the landing page. */
export function Navbar({ home = false }: { home?: boolean }) {
  const at = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <nav aria-label="Main" className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-5 py-2 md:px-16">
        <a href={home ? "#top" : "/"} aria-label="Aruna">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" width={48} height={48} className="size-12" />
        </a>
        <ul className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <li key={l.id}>
              <a href={at(l.id)} className="label text-sm transition-colors hover:text-muted">
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <Link href="/spec/" className="label text-sm transition-colors hover:text-muted">
              Spec
            </Link>
          </li>
        </ul>
        <Link href="/console/" tabIndex={-1}>
          <Button type="button" className="px-4 py-2.5 text-sm">
            Open the demo
          </Button>
        </Link>
      </div>
    </nav>
  );
}
