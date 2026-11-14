import type { Metadata } from "next";
import { Suspense } from "react";
import { Vault } from "@/console/screens/Vault";

export const metadata: Metadata = { title: "Vault | Aruna console" };

// The vault comes from the query string (?vault=), because vaults are created at runtime.
export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading the vault.</p>}>
      <Vault />
    </Suspense>
  );
}
