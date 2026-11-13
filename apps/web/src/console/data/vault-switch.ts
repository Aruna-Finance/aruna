import type { OwnedVault } from "./owned-vaults";

// Switching the vault a screen shows. The vault is named in the address (?vault=), so a switch is a link, and a screen stays
// shareable. Nothing is signed or sent.

export interface SwitchOption {
  value: string;
  label: string;
}

/** The current vault first, then every other vault the account owns, each once. The current one is listed even when the account only operates it. */
export function switchOptions(current: string, owned: readonly OwnedVault[]): SwitchOption[] {
  const seen = new Set<string>([current]);
  const rest = owned.filter((o) => !seen.has(o.vault) && seen.add(o.vault)).map((o) => ({ value: o.vault, label: o.vault }));
  return [{ value: current, label: current }, ...rest];
}

/**
 * Where to go to show `vault` on the same screen. Other parameters are kept (a report id stays), except an agent, which belongs to the
 * old vault: from an agent's page the switch goes to the new vault's agent list.
 */
export function switchHref(pathname: string, search: string, vault: string): string {
  const params = new URLSearchParams(search);
  params.set("vault", vault);
  params.delete("agent");
  const path = /\/agents\/detail\/?$/.test(pathname) ? "/console/agents/" : pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${path}?${params.toString()}`;
}
