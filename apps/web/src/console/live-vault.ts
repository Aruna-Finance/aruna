import type { ActorRole } from "./agent-actions";
import type { Relation } from "./walletRole";

// Which role the connected wallet may act as on a live vault (plan U6, R20, R21). The role switcher in the header
// can only narrow it: an owner may look at the vault as the operator, but an operator wallet can never act as owner,
// and a wallet that is neither can read and nothing else. The vault enforces all of this on chain regardless.

export function actorFor(relation: Relation | null, viewAs: "owner" | "operator" | string): ActorRole | null {
  if (relation === "owner") return viewAs === "operator" ? "operator" : "owner";
  if (relation === "operator") return "operator";
  return null;
}

/** Why every action is disabled when there is no acting role. */
export function noActorReason(relation: Relation | null): string {
  return relation === null ? "connect the owner's or operator's wallet to act" : "your connected account is neither the owner nor the operator";
}

export const VAULT_STORE_KEY = "aruna.console.vault";

/** The vault the console manages: the ?vault= link first, else the one remembered in this browser. */
export function chosenVault(fromUrl: string | null, stored: string | null, valid: (id: string) => boolean): string | null {
  if (fromUrl && valid(fromUrl)) return fromUrl;
  if (stored && valid(stored)) return stored;
  return null;
}
