import type { Metadata } from "next";
import { Suspense } from "react";
import { Coverage } from "@/console/screens/Coverage";

export const metadata: Metadata = { title: "Coverage | Aruna console" };

// ?vault= picks the vault, so the page reads the query string at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <Coverage />
    </Suspense>
  );
}
