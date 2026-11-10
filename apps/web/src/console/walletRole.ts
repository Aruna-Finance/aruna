/** How a connected wallet account relates to a vault, from the vault's own owner and operator fields. */
export type Relation = "owner" | "operator" | "none";

export function relationOf(account: string | null, vault: { owner: string; operator: string | null }): Relation | null {
  if (!account) return null;
  if (account === vault.owner) return "owner";
  if (vault.operator !== null && account === vault.operator) return "operator";
  return "none";
}

export const RELATION_TEXT: Record<Relation, string> = {
  owner: "Your connected account is the owner of this vault.",
  operator: "Your connected account is the operator of this vault. It cannot loosen limits or withdraw.",
  none: "Your connected account is neither the owner nor the operator of this vault. You can read it, not change it.",
};
