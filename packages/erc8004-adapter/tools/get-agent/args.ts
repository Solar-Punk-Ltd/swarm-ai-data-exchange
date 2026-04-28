import { parseArgs } from 'util';
import { requireArg, resolvePrivateKey } from '../utils/validation';

const { values } = parseArgs({
  options: {
    agentId: { type: 'string' },
    privateKey: { type: 'string' },
  },
  strict: true,
});

export const agentId = requireArg(values.agentId, 'agentId');
export const privateKey = resolvePrivateKey(values.privateKey);
