import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentWizard } from "@/console/screens/AgentWizard";

export const metadata: Metadata = { title: "Create an agent | Aruna console" };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <AgentWizard />
    </Suspense>
  );
}
