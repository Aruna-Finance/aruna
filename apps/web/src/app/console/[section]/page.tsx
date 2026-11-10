import { notFound } from "next/navigation";
import { Overview } from "@/console/screens/Overview";
import { Targets } from "@/console/screens/Targets";
import { ScreenPlaceholder } from "@/console/ScreenPlaceholder";
import { SCREENS, SCREEN_IDS, type ScreenId } from "@/console/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  // "agents" has its own route folder, because it has sub-pages.
  return SCREEN_IDS.filter((section) => section !== "agents").map((section) => ({ section }));
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
  if (section === "targets") return <Targets />;
  return <ScreenPlaceholder id={section as ScreenId} />;
}
