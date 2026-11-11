// Roles, sidebar sections and screen metadata, from the prototype's NAV table and docs/UI-PLAN.md.
// Signer names are the prototype's mock values.

export type RoleId = "owner" | "operator" | "underwriter" | "attestor" | "counterparty" | "developer";
export type ScreenId =
  | "dashboard"
  | "agents"
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
  signer: string;
  items: { id: ScreenId; label: string }[];
};

export const ROLES: Role[] = [
  {
    id: "owner",
    label: "Client",
    home: "dashboard",
    signer: "budi.testnet",
    items: [
      { id: "dashboard", label: "Overview" },
      { id: "create", label: "Create a vault" },
      { id: "agents", label: "Agents" },
      { id: "targets", label: "Targets" },
      { id: "coverage", label: "Coverage" },
      { id: "claims", label: "Claims" },
      { id: "migrate", label: "Migration" },
      { id: "story", label: "Guided demo" },
    ],
  },
  {
    id: "operator",
    label: "Operator",
    home: "dashboard",
    signer: "opsdesk.testnet",
    items: [
      { id: "dashboard", label: "Overview" },
      { id: "agents", label: "Agents" },
      { id: "targets", label: "Targets" },
      { id: "coverage", label: "Coverage" },
      { id: "claims", label: "Claims" },
      { id: "story", label: "Guided demo" },
    ],
  },
  {
    id: "underwriter",
    label: "Underwriter",
    home: "pool",
    signer: "underwriter.testnet",
    items: [
      { id: "pool", label: "Pool" },
      { id: "claims", label: "Claims" },
      { id: "simulation", label: "Simulation" },
      { id: "story", label: "Guided demo" },
    ],
  },
  {
    id: "attestor",
    label: "Attestor",
    home: "attestor",
    signer: "attestor-1.testnet",
    items: [
      { id: "attestor", label: "Console" },
      { id: "claims", label: "Reports and claims" },
      { id: "targets", label: "Targets" },
      { id: "story", label: "Guided demo" },
    ],
  },
  {
    id: "counterparty",
    label: "Counterparty",
    home: "lookup",
    signer: "No login",
    items: [
      { id: "lookup", label: "Look up an agent" },
      { id: "claims", label: "Reports and claims" },
      { id: "targets", label: "Targets" },
      { id: "story", label: "Guided demo" },
    ],
  },
  {
    id: "developer",
    label: "Developer",
    home: "developers",
    signer: "Agent key",
    items: [
      { id: "developers", label: "MCP tools" },
      { id: "playground", label: "Simulate and injection" },
      { id: "story", label: "Guided demo" },
    ],
  },
];

/** Which phase builds each screen, and what it will hold (docs/UI-PLAN.md). */
export const SCREENS: Record<ScreenId, { title: string; phase: string; plan: string; role: RoleId }> = {
  dashboard: {
    title: "Overview",
    phase: "F5",
    role: "owner",
    plan: "Vault, active agents, recorded exposure, premium for current policies, contracts touched and the cost of protection.",
  },
  agents: {
    title: "Agents",
    phase: "F5",
    role: "owner",
    plan: "Agents list and agent detail with tabs, policy test trail, freeze, resume and revoke, refusal score. Create-agent wizard.",
  },
  targets: {
    title: "Targets",
    phase: "F4",
    role: "counterparty",
    plan: "Class, certainty, premium effect, last recorded and freshness for each target, with the four drift channels and stored evidence.",
  },
  coverage: {
    title: "Coverage",
    phase: "F5",
    role: "owner",
    plan: "Coverage list and buy flow. Both trust assumptions are shown at purchase, and a stale attestor heartbeat blocks the buy and says why.",
  },
  claims: {
    title: "Reports and claims",
    phase: "F4",
    role: "counterparty",
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
    title: "Simulation",
    phase: "F6",
    role: "underwriter",
    plan: "Output of the pool simulation with assumptions listed and the scenario that breaks the pool shown as it is.",
  },
  attestor: {
    title: "Attestor console",
    phase: "F6",
    role: "attestor",
    plan: "Heartbeat, monitored targets and report drift. Built only after ownership is confirmed with the engine team.",
  },
  create: {
    title: "Create a vault",
    phase: "L2",
    role: "owner",
    plan: "Create your own vault on testnet, pick classified targets, fund it and see the setup checklist.",
  },
  lookup: {
    title: "Look up an agent",
    phase: "F4",
    role: "counterparty",
    plan: "Find an agent by vault, label or public key and read what it cannot do, with no login.",
  },
  developers: {
    title: "MCP tools",
    phase: "F7",
    role: "developer",
    plan: "Keyless and vault tools, and the reason-code table matching the contract set.",
  },
  playground: {
    title: "Simulate and injection",
    phase: "F7",
    role: "developer",
    plan: "Simulate an agent and run the injected agent, with refusals and auto-disable.",
  },
  story: {
    title: "Guided demo",
    phase: "F7",
    role: "developer",
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
