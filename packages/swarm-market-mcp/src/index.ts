#!/usr/bin/env node

import { SwarmMarketMCPServer } from './mcp-service';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  const swarmMarketMCPServer = new SwarmMarketMCPServer();
  const transport = new StdioServerTransport();
  await swarmMarketMCPServer.server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start Swarm Market MCP Server:', error);
  process.exit(1);
});
