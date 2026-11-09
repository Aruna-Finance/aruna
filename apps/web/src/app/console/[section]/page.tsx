import { notFound } from "next/navigation";
import { ScreenPlaceholder } from "@/console/ScreenPlaceholder";
import { SCREENS, SCREEN_IDS, type ScreenId } from "@/console/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return SCREEN_IDS.map((section) => ({ section }));
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SCREENS[section as ScreenId];
  return { title: s ? `${s.title} | Aruna console` : "Aruna console" };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in SCREENS)) notFound();
  return <ScreenPlaceholder id={section as ScreenId} />;
}
