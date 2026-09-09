/** Default Bee node API URL */
export const DEFAULT_BEE_API_URL = 'http://localhost:1633';

/** Default RPC endpoint for Base Sepolia */
export const DEFAULT_RPC_URL = 'https://sepolia.base.org';

/** Default ERC-8004 chain identifier */
export const DEFAULT_CHAIN = 'base-sepolia';

/**
 * Default Swarm feed topic used when uploading Agent Cards.
 * Non-hex strings are SHA-256 hashed to 32 bytes internally.
 */
export const AGENT_CARD_TOPIC = 'agent-card';

export const DEFAULT_GATEWAY_URL = 'https://api.gateway.ethswarm.org';

export const AGENT_CARD_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';

export const DEFAULT_AGENT_IMAGE =
  'https://api.gateway.ethswarm.org/bzz/1edce57714b542d7198b0fb271086f0f5eb6ece309bf0b5f8011a7b228c42bdd/img/avatar.jpg';

export const SWARM_AI_CAPABLE = 'swarm_ai_capable';

/**
 * Metadata key pointing at an agent's Swarm catalog feed owner address (0x-prefixed EOA).
 * Used as a fast index for "find my agent" lookups on startup — consumers MUST still
 * verify feed ownership + NFT ownership before trusting a match (metadata is spoofable).
 */
export const SWARM_AGENT_ID = 'swarm_agent_id';

/**
 * Metadata key binding an agent to its `RevenueSplitter` clone (0x-prefixed address).
 *
 * This is the authenticated agent <-> splitter link. It lives in the Identity Registry rather
 * than in the clone for two reasons: `SplitterFactory.createSplitter` is permissionless, so a
 * clone-held agentId would be an unauthenticated claim; and clone terms are frozen at
 * `initialize`, whereas agent NFT ownership can transfer, so a frozen binding would decay into a
 * lie with no way to correct it.
 *
 * `MetadataSet` indexes the key, so `findAgentsWithMetadata(AGENT_SPLITTER)` yields the whole
 * splitter -> agent reverse index in one log query.
 *
 * Consumers MUST still verify: an agent owner can name any address here. Check that the splitter
 * is in the factory registry and that its `seller` matches the agent's wallet or NFT owner.
 */
export const AGENT_SPLITTER = 'agent_splitter';

export const RECENT_BLOCK_COUNT = 550000;
