import { config } from '../../src';

export function requireArg(value: string | undefined, flag: string): string {
  if (!value?.trim()) {
    console.error(`Error: --${flag} is required`);
    process.exit(1);
  }
  return value.trim();
}

export function resolvePrivateKey(fromArg?: string): string {
  const key = fromArg ?? config.chain.privateKey;
  if (!key) {
    console.error('Error: --privateKey is required (or set PRIVATE_KEY env var)');
    process.exit(1);
  }
  return key;
}

export function resolveFeedPrivateKey(fromArg?: string): string {
  const key = fromArg ?? config.bee.feedPrivateKey;
  if (!key) {
    console.error('Error: --feedPrivateKey is required (or set BEE_FEED_PK env var)');
    process.exit(1);
  }
  return key;
}
