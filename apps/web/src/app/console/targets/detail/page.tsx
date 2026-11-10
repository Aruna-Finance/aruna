import type { Metadata } from "next";
import { Suspense } from "react";
import { TargetDetail } from "@/console/screens/TargetDetail";

export const metadata: Metadata = { title: "Target | Aruna console" };

// The target id comes from the query string (?id=), because targets are classified at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading the target.</p>}>
      <TargetDetail />
    </Suspense>
  );
}
