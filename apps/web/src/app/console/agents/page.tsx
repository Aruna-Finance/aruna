import type { Metadata } from "next";
import { AgentsList } from "@/console/screens/AgentsList";

export const metadata: Metadata = { title: "Agents | Aruna console" };

export default function Page() {
  return <AgentsList />;
}
