export { createERC8004Client } from './client';
export type { ERC8004Client } from './client';

export {
  generateAgentCard,
  generateRegistrationFile,
  serializeAgentCard,
  parseAgentCard,
} from './agent-card';

export { IdentityModule } from './modules/identity';
export { ReputationModule } from './modules/reputation';
export { AggregateModule } from './modules/aggregate';

export { IDENTITY_REGISTRY_ABI } from './abis/IdentityRegistry';
export { REPUTATION_REGISTRY_ABI } from './abis/ReputationRegistry';

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
} from './types';
