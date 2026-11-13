import type { Metadata } from "next";
import { Suspense } from "react";
import { Claims } from "@/console/screens/Claims";

export const metadata: Metadata = { title: "Reports and claims | Aruna console" };

// ?vault= picks the vault, so the page reads the query string at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading.</p>}>
      <Claims />
    </Suspense>
  );
}
