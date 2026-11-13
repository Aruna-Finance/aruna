// How an agent whose key is held elsewhere reaches the vault. The MCP server and its two environment variables are the ones
// in packages/mcp/README.md; the examples/ scripts are fixed to the demo2 vault, so they are not offered here.

export const KEY_FILE_NOTE = 'A JSON file with the agent\'s private key as {"private_key": "ed25519:..."}, kept outside the repository.';

export function mcpAgentCommand(vault: string, keyFile = "/path/to/agent-key.json"): string {
  return `ARUNA_AGENT_VAULT=${vault} \\nARUNA_AGENT_KEY_FILE=${keyFile} \\nnode packages/mcp/dist/index.js`;
}
