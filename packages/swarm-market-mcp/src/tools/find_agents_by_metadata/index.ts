/**
 * MCP Tool: find_agents_by_metadata
 *
 * Scans MetadataSet events for a given metadata key and returns matching agents
 * (agentId, tokenURI, NFT owner, and the utf-8-decoded metadata value). Intended as
 * a fast index for "find my agent" lookups on startup — callers MUST still verify
 * feed ownership + NFT ownership before trusting a match, since metadata is spoofable.
 *
 * Wraps IdentityModule.findAgentsWithMetadata and augments each entry with the on-chain
 * owner so a caller can complete a full verification chain in one round trip.
 */
import { ethers } from 'ethers';
import { createERC8004Client, SWARM_AGENT_ID } from '@solarpunk/erc8004-adapter';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
} from '../../utils';
import {
  FindAgentsByMetadataArgs,
  FindAgentsByMetadataResult,
  FindAgentsByMetadataResultEntry,
} from './models';

export async function findAgentsByMetadata(args: FindAgentsByMetadataArgs): Promise<ToolResponse> {
  // Resolve semantic mode → raw key/value. catalogFeedOwner is the primary lookup path
  // for agent bootstrap; the raw metadataKey/metadataValue path is kept as an escape hatch.
  const metadataKey = args.catalogFeedOwner ? SWARM_AGENT_ID : args.metadataKey;
  const metadataValue = args.catalogFeedOwner
    ? args.catalogFeedOwner.toLowerCase()
    : args.metadataValue;
  if (!metadataKey) {
    return getToolErrorResponse('Provide either catalogFeedOwner or metadataKey.');
  }

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc8004 = createERC8004Client({ provider, chain: config.chain.chain });

  let entries: { agentId: bigint; uri: string; rawValue: Uint8Array }[];
  try {
    entries = await erc8004.identity.findAgentsWithMetadata(metadataKey, args.fromBlock);
  } catch (err) {
    return getToolErrorResponse(
      `Failed to scan MetadataSet events for key ${metadataKey}: ${getErrorMessage(err)}`,
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const filtered = metadataValue
    ? entries.filter((e) => decoder.decode(e.rawValue) === metadataValue)
    : entries;

  let agents: FindAgentsByMetadataResultEntry[];
  try {
    agents = await Promise.all(
      filtered.map(async (e) => ({
        agentId: e.agentId.toString(),
        agentURI: e.uri,
        owner: await erc8004.identity.getOwner(e.agentId),
        metadataValue: decoder.decode(e.rawValue),
      })),
    );
  } catch (err) {
    return getToolErrorResponse(
      `Failed to resolve owners for matched agents: ${getErrorMessage(err)}`,
    );
  }

  const result: FindAgentsByMetadataResult = {
    metadataKey,
    agents,
  };
  return getResponseWithStructuredContent(result);
}
