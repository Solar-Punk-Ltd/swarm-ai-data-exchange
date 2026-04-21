import { Bee } from '@ethersphere/bee-js';

const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633';

export const bee = new Bee(BEE_API_URL);
