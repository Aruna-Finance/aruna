import type { ClassEvidence, RiskClass } from "@/landing/lib/classifier-types";

/** What each class means for a policy and its price, from the prototype's class table. */
export const CLASS_INFO: Record<RiskClass, { title: string; basis: string; certainty: string; premium: string }> = {
  immutable_verified: {
    title: "Immutable, proved",
    basis: "Code by hash, no full-access key, and none of the scanned imports in the WASM.",
    certainty: "No detected upgrade path, and sticky",
    premium: "Lowest premium",
  },
  local_upgradeable: {
    title: "Local upgradeable",
    basis: "The account's own code, or an upgrade path that cannot be ruled out.",
    certainty: "Detected",
    premium: "Base premium",
  },
  global_by_account: {
    title: "Global by account",
    basis: "References a global contract another account can redeploy.",
    certainty: "Detected through a separate channel",
    premium: "Highest premium",
  },
  unknown: {
    title: "Unknown",
    basis: "Cannot be determined from the available data.",
    certainty: "Not known",
    premium: "Cannot be covered",
  },
};

export const CLASS_ORDER: RiskClass[] = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"];

/** Plain-language reading of the stored mutability basis. */
export const BASIS: Record<ClassEvidence["mutabilityBasis"], string> = {
  no_detected_path: "No detected upgrade path under the checks listed",
  full_access_key: "A full-access key can change the code",
  upgrade_imports: "Upgrade imports present. They may have no reachable route",
  own_code: "The account's own code, with no full-access key and clean imports",
  global_owner: "Another account can redeploy the code",
  undetermined: "Could not be determined",
};

