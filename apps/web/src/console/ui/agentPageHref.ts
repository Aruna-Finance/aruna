/** The public agent page takes the vault and the key from the query string, because both are looked up at runtime. */
export const agentPageHref = (vault: string, key: string) =>
  `/console/lookup/agent/?vault=${encodeURIComponent(vault)}&key=${encodeURIComponent(key)}`;
