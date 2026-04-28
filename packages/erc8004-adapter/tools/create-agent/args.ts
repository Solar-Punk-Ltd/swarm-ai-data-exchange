import { parseArgs } from 'util';
import { config } from '../../src';
import { requireArg, resolvePrivateKey, resolveFeedPrivateKey } from '../utils/validation';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    description: { type: 'string' },
    image: { type: 'string' },
    version: { type: 'string' },
    x402: { type: 'string' },
    swarm: { type: 'string' },
    capabilities: { type: 'string' },
    privateKey: { type: 'string' },
    feedPrivateKey: { type: 'string' },
    postageBatchId: { type: 'string' },
    beeApiUrl: { type: 'string' },
  },
  strict: true,
});

export const name = requireArg(values.name, 'name');
export const description = requireArg(values.description, 'description');
export const version = values.version ?? '1.0.0';
export const image = values.image?.trim() || undefined;
export const x402 = values.x402?.trim() || undefined;
export const swarm = values.swarm?.trim() || undefined;
export const capabilities = values.capabilities
  ? values.capabilities
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
  : [];
export const beeApiUrl = values.beeApiUrl ?? config.bee.endpoint;
export const privateKey = resolvePrivateKey(values.privateKey);
export const feedPk = resolveFeedPrivateKey(values.feedPrivateKey);
export const batchId = values.postageBatchId ?? config.bee.postageBatchId;
