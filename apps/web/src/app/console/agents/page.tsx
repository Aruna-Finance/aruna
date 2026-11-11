import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentsList } from "@/console/screens/AgentsList";

export const metadata: Metadata = { title: "Agents | Aruna console" };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <AgentsList />
    </Suspense>
  );
}
