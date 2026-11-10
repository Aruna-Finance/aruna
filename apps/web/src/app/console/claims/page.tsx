import type { Metadata } from "next";
import { Claims } from "@/console/screens/Claims";

export const metadata: Metadata = { title: "Reports and claims | Aruna console" };

export default function Page() {
  return <Claims />;
}
