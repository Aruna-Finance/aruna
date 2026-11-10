import type { Metadata } from "next";
import { RoleProvider } from "@/console/RoleContext";
import { Shell } from "@/console/Shell";
import { TxProvider } from "@/console/TxContext";

export const metadata: Metadata = {
  title: "Aruna console",
  description: "Owner, operator, underwriter and attestor views for Aruna vaults. Testnet, simulated data.",
};

/** Everything under /console/ is the app. Its code lives in src/console and is never imported by the landing page. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <TxProvider>
        <Shell>{children}</Shell>
      </TxProvider>
    </RoleProvider>
  );
}
