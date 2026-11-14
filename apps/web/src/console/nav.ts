// Roles, sidebar sections and screen metadata. See docs/FRONTEND.md.
// Signer names are the prototype's mock values.

export type RoleId = "owner" | "operator" | "underwriter";
export type ScreenId =
  | "dashboard"
  | "agents"
  | "vault"
  | "targets"
  | "coverage"
  | "claims"
  | "migrate"
  | "pool"
  | "simulation"
  | "attestor"
  | "lookup"
  | "create"
  | "developers"
  | "playground"
  | "story";

export type Role = {
  id: RoleId;
  label: string;
  home: ScreenId;
  /** `hidden` screens belong to the role (deep links keep it) but are reached from a page or a footer link, not the sidebar. */
  items: { id: ScreenId; label: string; hidden?: true }[];
};

export const ROLES: Role[] = [
  {
    id: "owner",
    label: "Client",
    home: "dashboard",
    items: [
      { id: "dashboard", label: "Overview" },
      { id: "vault", label: "Vault" },
      { id: "agents", label: "Agents" },
      { id: "coverage", label: "Coverage" },
      { id: "create", label: "Create a vault", hidden: true },
      { id: "migrate", label: "Migration", hidden: true },
      { id: "story", label: "Guided demo", hidden: true },
      { id: "developers", label: "SDK and MCP", hidden: true },
      { id: "targets", label: "Contracts", hidden: true },
      { id: "claims", label: "Change reports", hidden: true },
      { id: "lookup", label: "Check an agent", hidden: true },
      { id: "attestor", label: "Who reports changes", hidden: true },
    ],
  },
  {
    id: "operator",
    label: "Operator",
    home: "dashboard",
    items: [
      { id: "dashboard", label: "Overview" },
      { id: "agents", label: "Agents" },
      { id: "playground", label: "Playground" },
      { id: "coverage", label: "Coverage" },
      { id: "story", label: "Guided demo", hidden: true },
      { id: "developers", label: "SDK and MCP", hidden: true },
      { id: "targets", label: "Contracts", hidden: true },
      { id: "claims", label: "Change reports", hidden: true },
      { id: "lookup", label: "Check an agent", hidden: true },
      { id: "attestor", label: "Who reports changes", hidden: true },
    ],
  },
  {
    id: "underwriter",
    label: "Underwriter",
    home: "pool",
    items: [
      { id: "pool", label: "Pool" },
      { id: "simulation", label: "Stress test" },
      { id: "story", label: "Guided demo", hidden: true },
      { id: "developers", label: "SDK and MCP", hidden: true },
      { id: "targets", label: "Contracts", hidden: true },
      { id: "claims", label: "Change reports", hidden: true },
      { id: "lookup", label: "Check an agent", hidden: true },
      { id: "attestor", label: "Who reports changes", hidden: true },
    ],
  },
];

/** Which phase builds each screen, and what it will hold. */
export const SCREENS: Record<ScreenId, { title: string; phase: string; plan: string; role: RoleId }> = {
  dashboard: {
    title: "Overview",
    phase: "F5",
    role: "owner",
    plan: "Vault, active agents, recorded exposure, premium for current policies, contracts touched and the cost of protection.",
  },
  vault: {
    title: "Vault",
    phase: "F5",
    role: "owner",
    plan: "The vault's funds with deposit and withdraw, its operator and limits, creating another vault and moving to a new one.",
  },
  agents: {
    title: "Agents",
    phase: "F5",
    role: "owner",
    plan: "Agents list and agent detail with tabs, policy test trail, freeze, resume and revoke, refusal score. Create-agent wizard.",
  },
  targets: {
    title: "Contracts",
    phase: "F4",
    role: "owner",
    plan: "Class, certainty, premium effect, last recorded and freshness for each target, with the four drift channels and stored evidence.",
  },
  coverage: {
    title: "Coverage",
    phase: "F5",
    role: "owner",
    plan: "Coverage list and buy flow. Both trust assumptions are shown at purchase, and a stale attestor heartbeat blocks the buy and says why.",
  },
  claims: {
    title: "Change reports and claims",
    phase: "F4",
    role: "owner",
    plan: "Reports and claims, readable by everyone, with the challenge window and dispute state.",
  },
  migrate: {
    title: "Migration",
    phase: "F5",
    role: "owner",
    plan: "Pause, create a new vault, move funds and re-register agents, revoke old keys and withdraw. Coverage does not transfer.",
  },
  pool: {
    title: "Pool",
    phase: "F6",
    role: "underwriter",
    plan: "Concentration by code hash given top weight, capital deployed and locked, claims pending, disputed and paid.",
  },
  simulation: {
    title: "Stress test",
    phase: "F6",
    role: "underwriter",
    plan: "Output of the pool simulation with assumptions listed and the scenario that breaks the pool shown as it is.",
  },
  attestor: {
    title: "Who reports changes",
    phase: "F6",
    role: "owner",
    plan: "Heartbeat, monitored targets and report drift. Built only after ownership is confirmed with the engine team.",
  },
  create: {
    title: "Create a vault",
    phase: "L2",
    role: "owner",
    plan: "Create your own vault on testnet, pick classified targets, fund it and see the setup checklist.",
  },
  lookup: {
    title: "Check an agent",
    phase: "F4",
    role: "owner",
    plan: "Find an agent by vault, label or public key and read what it cannot do, with no login.",
  },
  developers: {
    title: "SDK and MCP",
    phase: "F7",
    role: "owner",
    plan: "Keyless and vault tools, and the reason-code table matching the contract set.",
  },
  playground: {
    title: "Playground",
    phase: "F7",
    role: "operator",
    plan: "Simulate an agent and run the injected agent, with refusals and auto-disable.",
  },
  story: {
    title: "Guided demo",
    phase: "F7",
    role: "owner",
    plan: "Eight steps from classifying a contract to a paid claim and a rejected false report, on the same state the screens read.",
  },
};

export const SCREEN_IDS = Object.keys(SCREENS) as ScreenId[];

export const roleById = (id: RoleId): Role => ROLES.find((r) => r.id === id)!;

/** The role to show for a screen: keep the current one when it has that screen, else the screen's own role. */
export function roleFor(screen: ScreenId, current: RoleId): RoleId {
  if (roleById(current).items.some((i) => i.id === screen)) return current;
  return SCREENS[screen].role;
}
