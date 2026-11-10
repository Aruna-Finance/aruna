import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicAgent } from "@/console/screens/PublicAgent";

export const metadata: Metadata = { title: "Public agent page | Aruna console" };

// The vault and key come from the query string (?vault=&key=), because both are looked up at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading the agent.</p>}>
      <PublicAgent />
    </Suspense>
  );
}
