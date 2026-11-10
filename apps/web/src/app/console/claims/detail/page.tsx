import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportDetail } from "@/console/screens/ReportDetail";

export const metadata: Metadata = { title: "Report | Aruna console" };

// The report id comes from the query string (?id=), because reports are created at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading the report.</p>}>
      <ReportDetail />
    </Suspense>
  );
}
