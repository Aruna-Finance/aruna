"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/shared/Select";
import { LISTED_ROLES, SCREEN_IDS, roleById, roleFor, type RoleId, type ScreenId } from "./nav";
import { useRole } from "./RoleContext";
import { ThemeToggle } from "./ui/ThemeToggle";
import { WalletButton } from "./ui/WalletButton";

const screenOf = (path: string): ScreenId | null => {
  const seg = path.split("/").filter(Boolean)[1]; // /console/<screen>/
  return (SCREEN_IDS as string[]).includes(seg) ? (seg as ScreenId) : null;
};

/** Screens reached from another screen's page, not from the sidebar: the sidebar item they belong to stays highlighted. */
const BELONGS_TO: Partial<Record<ScreenId, ScreenId>> = { create: "vault", migrate: "vault" };

/** Top bar, role switcher, sidebar. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const screen = screenOf(path);
  const router = useRouter();
  const { role, setRole, ready } = useRole();

  // A deep link to a screen the current role does not have switches to the role that does. It runs again once the
  // stored role is read, so a role restored from storage never shows a sidebar the page is not in.
  useEffect(() => {
    if (screen && ready) {
      const next = roleFor(screen, role);
      if (next !== role) setRole(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, ready]);

  const current = roleById(role);
  const lit = screen && current.items.some((i) => i.id === BELONGS_TO[screen] && !i.hidden) ? BELONGS_TO[screen] : screen;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 max-sm:justify-between md:px-6">
          <Link href="/" aria-label="Aruna site" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="" width={40} height={40} className="size-10 dark:mix-blend-lighten dark:invert" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:order-last max-sm:basis-full">
            <span className="label hidden shrink-0 text-xs text-muted sm:inline">View as</span>
            <Select<RoleId>
              label="View as"
              value={current.unlisted ? "owner" : role}
              options={LISTED_ROLES.map((r) => ({ value: r.id, label: r.label }))}
              onValueChange={(id) => {
                setRole(id);
                router.push(`/console/${roleById(id).home}/`);
              }}
              className="w-full max-w-[260px] min-w-0! truncate py-2.5! max-sm:max-w-none [&>span]:truncate"
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            <span className="label border border-line-2 px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs">testnet</span>
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto border-b border-line bg-paper p-3 lg:sticky lg:top-[57px] lg:h-[calc(100svh-57px)] lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-y-auto lg:overflow-x-hidden lg:border-r lg:border-b-0 lg:p-4"
        >
          {current.items.filter((i) => !i.hidden).map((i) => (
            <Link
              key={i.id}
              href={`/console/${i.id}/`}
              aria-current={lit === i.id ? "page" : undefined}
              className="label shrink-0 border border-transparent px-3 py-2 text-sm transition-colors hover:border-line aria-[current=page]:border-line-2"
            >
              {i.label}
            </Link>
          ))}
          <Link
            href="/console/story/"
            aria-current={screen === "story" ? "page" : undefined}
            className="label shrink-0 border border-transparent px-3 py-2 text-sm text-muted transition-colors hover:border-line aria-[current=page]:border-line-2 aria-[current=page]:text-ink lg:mt-auto"
          >
            Demo (mock data)
          </Link>
        </nav>
        <main className="console-main min-w-0 flex-1 bg-wash px-4 py-8 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
