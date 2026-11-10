import { notFound } from "next/navigation";
import { Migration } from "@/console/screens/Migration";
import { Overview } from "@/console/screens/Overview";
import { ScreenPlaceholder } from "@/console/ScreenPlaceholder";
import { SCREENS, SCREEN_IDS, type ScreenId } from "@/console/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  // "agents", "coverage", "claims" and "targets" have their own route folders, because they have sub-pages.
  const own = new Set(["agents", "coverage", "claims", "targets"]);
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
  if (section === "migrate") return <Migration />;
  return <ScreenPlaceholder id={section as ScreenId} />;
}
