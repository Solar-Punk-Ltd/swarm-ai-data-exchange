import { parseArgs } from 'util';
import { resolvePrivateKey } from '../utils/validation';

const { values } = parseArgs({
  options: {
    privateKey: { type: 'string' },
  },
  strict: true,
});

export const privateKey = resolvePrivateKey(values.privateKey);
