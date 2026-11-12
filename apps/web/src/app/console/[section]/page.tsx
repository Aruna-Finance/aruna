import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Attestor } from "@/console/screens/Attestor";
import { CreateVault } from "@/console/screens/CreateVault";
import { Developers } from "@/console/screens/Developers";
import { Migration } from "@/console/screens/Migration";
import { Overview } from "@/console/screens/Overview";
import { Pool } from "@/console/screens/Pool";
import { Playground } from "@/console/screens/Playground";
import { Simulation } from "@/console/screens/Simulation";
import { Story } from "@/console/screens/Story";
import { ScreenPlaceholder } from "@/console/ScreenPlaceholder";
import { SCREENS, SCREEN_IDS, type ScreenId } from "@/console/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  // "agents", "coverage", "claims" and "targets" have their own route folders, because they have sub-pages.
  const own = new Set(["agents", "coverage", "claims", "targets", "lookup"]);
  return SCREEN_IDS.filter((section) => !own.has(section)).map((section) => ({ section }));
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SCREENS[section as ScreenId];
  return { title: s ? `${s.title} | Aruna console` : "Aruna console" };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in SCREENS)) notFound();
  if (section === "dashboard") return <Overview />;
  if (section === "create") return <CreateVault />;
  if (section === "migrate") return <Migration />;
  if (section === "developers") return <Developers />;
  if (section === "pool") return <Pool />;
  if (section === "simulation") return <Simulation />;
  if (section === "story") return <Story />;
  if (section === "attestor") return <Attestor />;
  if (section === "playground")
    return (
      <Suspense fallback={<p className="text-muted">Loading.</p>}>
        <Playground />
      </Suspense>
    );
  return <ScreenPlaceholder id={section as ScreenId} />;
}
