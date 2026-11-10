import type { TargetRecord } from "./types";

export type ChannelKey = "resolved_code" | "deploy_contract" | "use_global_contract" | "deploy_global_contract";
export type ChannelState = "clear" | "changed" | "not applicable";
export interface Channel {
  name: string;
  key: ChannelKey;
  state: ChannelState;
}

/**
 * The four channels docs/ATTESTOR.md requires. A channel is "not applicable" when the target's code reference cannot
 * use it. `changed` names the channel that saw a change, if any.
 */
export function channelsOf(t: TargetRecord, changed?: ChannelKey | null): Channel[] {
  const ref = t.classification.evidence.codeRef;
  const hit = (k: ChannelKey): ChannelState => (changed === k || (k === "resolved_code" && (t.frozen || !!changed)) ? "changed" : "clear");
  return [
    { name: "view_code hash, polled", key: "resolved_code", state: hit("resolved_code") },
    { name: "DeployContract on the target", key: "deploy_contract", state: hit("deploy_contract") },
    { name: "UseGlobalContract on the target", key: "use_global_contract", state: ref && ref.kind !== "local" ? hit("use_global_contract") : "not applicable" },
    { name: "DeployGlobalContract on the owner", key: "deploy_global_contract", state: ref?.kind === "global_account" ? hit("deploy_global_contract") : "not applicable" },
  ];
}

/** The channel that sees a target's owner shipping new code. */
export function upgradeChannel(t: TargetRecord): ChannelKey {
  const ref = t.classification.evidence.codeRef;
  if (ref?.kind === "global_account") return "deploy_global_contract";
  if (ref?.kind === "global_hash") return "use_global_contract";
  return "deploy_contract";
}
