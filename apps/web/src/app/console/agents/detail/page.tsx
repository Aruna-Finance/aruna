import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentDetail } from "@/console/screens/AgentDetail";

export const metadata: Metadata = { title: "Agent | Aruna console" };

// The agent id comes from the query string (?id=), because agents are created at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading the agent.</p>}>
      <AgentDetail />
    </Suspense>
  );
}
