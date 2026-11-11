"use client";

import { useLiveVault } from "../useLiveVault";
import { NoVault } from "../ui/NoVault";
import { LiveAgentWizard } from "./LiveAgentWizard";

export function AgentWizard() {
  const live = useLiveVault();
  return live.status === "ok" ? <LiveAgentWizard live={live} /> : <NoVault live={live} title="Create an agent" />;
}
