"use client";

import { useLiveVault } from "../useLiveVault";
import { NoVault } from "../ui/NoVault";
import { LiveAgents } from "./LiveAgents";

export function AgentsList() {
  const live = useLiveVault();
  return live.status === "ok" ? <LiveAgents live={live} /> : <NoVault live={live} title="Agents" />;
}
