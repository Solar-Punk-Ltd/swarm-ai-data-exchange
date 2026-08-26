/**
 * MCP Service for the Swarm AI marketplace catalog operations.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { Bee } from '@ethersphere/bee-js';
import config from './config';
import { SwarmMarketToolsSchema } from './schemas';
import { getToolErrorResponse, ToolResponse } from './utils';
import { buildCatalog } from './tools/build_catalog';
import type { BuildCatalogArgs } from './tools/build_catalog/models';
import { getAgent } from './tools/get_agent';
import type { GetAgentArgs } from './tools/get_agent/models';
import { deleteCatalogItem } from './tools/delete_catalog_item';
import type { DeleteCatalogItemArgs } from './tools/delete_catalog_item/models';
import { deleteCatalog } from './tools/delete_catalog';
import type { DeleteCatalogArgs } from './tools/delete_catalog/models';
import { purchaseCatalogItem } from './tools/purchase_catalog_item';
import type { PurchaseCatalogItemArgs } from './tools/purchase_catalog_item/models';
import { createAgent } from './tools/create_agent';
import type { CreateAgentArgs } from './tools/create_agent/models';
import { findAgentsByMetadata } from './tools/find_agents_by_metadata';
import type { FindAgentsByMetadataArgs } from './tools/find_agents_by_metadata/models';
import { createSplitContract } from './tools/create_split_contract';
import type { CreateSplitContractArgs } from './tools/create_split_contract/models';
import { getSplitContract } from './tools/get_split_contract';
import type { GetSplitContractArgs } from './tools/get_split_contract/models';
import {
  buildCatalogSchema,
  createAgentSchema,
  deleteCatalogItemSchema,
  deleteCatalogSchema,
  createSplitContractSchema,
  getSplitContractSchema,
  findAgentsByMetadataSchema,
  getAgentSchema,
  purchaseCatalogItemSchema,
} from './schemas/zod-schemas';

export class SwarmMarketMCPServer {
  public readonly server: McpServer;
  private readonly bee: Bee;

  constructor() {
    this.bee = new Bee(config.bee.endpoint);

    this.server = new McpServer(
      {
        name: 'swarm-market-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    const server = this.server.server;

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...SwarmMarketToolsSchema],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResponse> => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'build_catalog': {
            const validArgs = buildCatalogSchema.parse(args);
            return buildCatalog(validArgs as unknown as BuildCatalogArgs, this.bee);
          }

          case 'get_agent': {
            const validArgs = getAgentSchema.parse(args);
            return getAgent(validArgs as GetAgentArgs, this.bee);
          }

          case 'delete_catalog_item': {
            const validArgs = deleteCatalogItemSchema.parse(args);
            return deleteCatalogItem(validArgs as DeleteCatalogItemArgs, this.bee);
          }

          case 'delete_catalog': {
            const validArgs = deleteCatalogSchema.parse(args);
            return deleteCatalog(validArgs as DeleteCatalogArgs, this.bee);
          }

          case 'purchase_catalog_item': {
            const validArgs = purchaseCatalogItemSchema.parse(args);
            return purchaseCatalogItem(validArgs as PurchaseCatalogItemArgs, this.bee);
          }

          case 'create_agent': {
            const validArgs = createAgentSchema.parse(args);
            return createAgent(validArgs as CreateAgentArgs);
          }

          case 'find_agents_by_metadata': {
            const validArgs = findAgentsByMetadataSchema.parse(args);
            return findAgentsByMetadata(validArgs as FindAgentsByMetadataArgs);
          }

          case 'create_split_contract': {
            const validArgs = createSplitContractSchema.parse(args);
            return createSplitContract(validArgs as CreateSplitContractArgs);
          }

          case 'get_split_contract': {
            const validArgs = getSplitContractSchema.parse(args);
            return getSplitContract(validArgs as GetSplitContractArgs);
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof ZodError) {
          return getToolErrorResponse(error.errors[0].message);
        }
        throw error;
      }
    });

    this.server.server.onerror = (error: Error) => console.error('[Error]', error);

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }
}
