export { createERC8004Client } from './client';
export type { ERC8004Client } from './client';

export {
  generateAgentCard,
  generateRegistrationFile,
  serializeAgentCard,
  parseAgentCard,
  uploadAgentCard,
} from './agent-card';

export { IdentityModule } from './modules/identity';
export { ReputationModule } from './modules/reputation';
export { AggregateModule } from './modules/aggregate';

export { IDENTITY_REGISTRY_ABI } from './abis/IdentityRegistry';
export { REPUTATION_REGISTRY_ABI } from './abis/ReputationRegistry';

export { DEFAULT_BEE_API_URL, DEFAULT_RPC_URL, DEFAULT_CHAIN, AGENT_CARD_TOPIC } from './constants';

export { default as config } from './config';
export type { ERC8004AdapterConfig, ChainConfig, BeeConfig } from './config';

export type {
  ERC8004Config,
  AgentCard,
  AgentCardParams,
  AgentEndpoints,
  RegisterResult,
  PostFeedbackParams,
  FeedbackAuth,
  FeedbackResult,
  ReputationSummary,
  ReputationScore,
  SwarmUploadResult,
} from './types';
