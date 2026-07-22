import { parseArgs } from 'util';
import { requireArg } from '../utils/validation';

const { values } = parseArgs({
  options: {
    agentId: { type: 'string' },
  },
  strict: true,
});

export const agentId = requireArg(values.agentId, 'agentId');
