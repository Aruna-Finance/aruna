import type { Metadata } from "next";
import { AgentWizard } from "@/console/screens/AgentWizard";

export const metadata: Metadata = { title: "Create an agent | Aruna console" };

export default function Page() {
  return <AgentWizard />;
}
