#!/usr/bin/env node
// aruna-mcp — stdio MCP server with Aruna's keyless classifier tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "aruna", version: "0.1.0" });
registerTools(server);
await server.connect(new StdioServerTransport());
