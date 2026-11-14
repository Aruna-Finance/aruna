import type { RiskClass } from "./classifier-types";

/**
 * The words users see for each risk class, and the tooltip that explains them. The raw class name stays in the
 * tooltip and on evidence pages. One source for the landing page and the console.
 */
export const CLASS_LABEL: Record<RiskClass, string> = {
  immutable_verified: "Can't change",
  local_upgradeable: "Upgradeable by owner",
  global_by_account: "Can change silently",
  unknown: "Unknown, not coverable",
};

export const CLASS_HINT: Record<RiskClass, string> = {
  immutable_verified: "No one can change this contract's code. Lowest coverage price.",
  local_upgradeable: "The contract's own account may be able to deploy new code. Such a change happens in a transaction on the contract.",
  global_by_account:
    "The code comes from another account, which can replace it with no transaction on this contract. Most monitors miss this. Highest coverage price.",
  unknown: "Public chain data could not show whether the code can change, so it cannot be covered.",
};

/** Tooltip text: what the label means, then the technical class name. */
export const classHint = (c: RiskClass) => `${CLASS_HINT[c]} Technical class: ${c}.`;

/** The label for a class string read from the chain; an unrecognised value is shown as it is. */
export const classLabelOf = (c: string): string => (c in CLASS_LABEL ? CLASS_LABEL[c as RiskClass] : c);
