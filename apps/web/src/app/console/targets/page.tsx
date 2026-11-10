import type { Metadata } from "next";
import { Targets } from "@/console/screens/Targets";

export const metadata: Metadata = { title: "Targets | Aruna console" };

export default function Page() {
  return <Targets />;
}
