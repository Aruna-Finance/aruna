"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLES, SCREEN_IDS, roleById, roleFor, type ScreenId } from "./nav";
import { useRole } from "./RoleContext";
import { WalletButton } from "./ui/WalletButton";

const screenOf = (path: string): ScreenId | null => {
  const seg = path.split("/").filter(Boolean)[1]; // /console/<screen>/
  return (SCREEN_IDS as string[]).includes(seg) ? (seg as ScreenId) : null;
};

/** Top bar, role switcher, sidebar. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const screen = screenOf(path);
  const { role, setRole } = useRole();

  // A deep link to a screen the current role does not have switches to the role that does.
  useEffect(() => {
    if (screen) {
      const next = roleFor(screen, role);
      if (next !== role) setRole(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const current = roleById(role);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="flex items-center gap-4 px-4 py-2 md:px-6">
          <Link href="/" aria-label="Aruna site" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="" width={40} height={40} className="size-10" />
          </Link>
          <nav aria-label="Role" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {ROLES.map((r) => (
              <Link
                key={r.id}
                href={`/console/${r.home}/`}
                onClick={() => setRole(r.id)}
                aria-current={r.id === role ? "true" : undefined}
                className="label shrink-0 border border-transparent px-3 py-2 text-[13px] transition-colors hover:border-line-2 aria-[current=true]:border-ink aria-[current=true]:bg-ink aria-[current=true]:text-paper"
              >
                {r.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="label hidden border border-line-2 px-2 py-0.5 text-xs sm:inline">testnet</span>
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto border-b border-line bg-paper p-3 lg:sticky lg:top-[57px] lg:h-[calc(100svh-57px)] lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-y-auto lg:overflow-x-hidden lg:border-r lg:border-b-0 lg:p-4"
        >
          {current.items.map((i) => (
            <Link
              key={i.id}
              href={`/console/${i.id}/`}
              aria-current={screen === i.id ? "page" : undefined}
              className="shrink-0 px-3 py-2 text-[15px] transition-colors hover:bg-wash aria-[current=page]:bg-fog aria-[current=page]:font-medium"
            >
              {i.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 bg-wash px-4 py-8 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
