import type { Metadata } from "next";
import { Suspense } from "react";
import { CoverageBuy } from "@/console/screens/CoverageBuy";

export const metadata: Metadata = { title: "Buy coverage | Aruna console" };

// ?agent= preselects the agent, so the page reads the query string at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <CoverageBuy />
    </Suspense>
  );
}
