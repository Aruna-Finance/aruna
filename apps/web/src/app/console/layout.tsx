import type { Metadata } from "next";
import { RoleProvider } from "@/console/RoleContext";
import { Shell } from "@/console/Shell";
import { TxProvider } from "@/console/TxContext";
import { WalletProvider } from "@/console/WalletContext";

export const metadata: Metadata = {
  title: "Aruna console",
  description: "Vaults, agents and coverage for Aruna on NEAR testnet.",
};

/** Everything under /console/ is the app. Its code lives in src/console and is never imported by the landing page. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <WalletProvider>
        <TxProvider>
          <Shell>{children}</Shell>
        </TxProvider>
      </WalletProvider>
    </RoleProvider>
  );
}
