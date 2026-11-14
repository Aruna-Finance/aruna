import type { Metadata } from "next";
import { VaultList } from "@/console/screens/VaultList";

export const metadata: Metadata = { title: "Vaults | Aruna console" };

export default function Page() {
  return <VaultList />;
}
