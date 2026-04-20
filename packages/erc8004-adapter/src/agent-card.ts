import type { AgentCard, AgentCardParams } from './types';

export function generateAgentCard(params: AgentCardParams): AgentCard {
  return {
    name: params.name,
    description: params.description,
    version: params.version ?? '1.0.0',
    capabilities: params.capabilities,
    endpoints: params.endpoints,
    supportedTrust: params.supportedTrust ?? ['reputation'],
    ...(params.owner !== undefined && { owner: params.owner }),
  };
}

// Alias matching the name used in ERC-8004.md examples
export const generateRegistrationFile = generateAgentCard;

export function serializeAgentCard(card: AgentCard): string {
  return JSON.stringify(card, null, 2);
}

export function parseAgentCard(json: string): AgentCard {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (!data.name || !data.description || !data.endpoints) {
    throw new Error('Invalid agent card: missing required fields (name, description, endpoints)');
  }
  return data as unknown as AgentCard;
}
