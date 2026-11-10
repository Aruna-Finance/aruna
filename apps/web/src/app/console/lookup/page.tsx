import type { Metadata } from "next";
import { Suspense } from "react";
import { Lookup } from "@/console/screens/Lookup";

export const metadata: Metadata = { title: "Look up an agent | Aruna console" };

// The vault comes from the query string (?vault=) so a lookup can be shared as a link.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <Lookup />
    </Suspense>
  );
}
