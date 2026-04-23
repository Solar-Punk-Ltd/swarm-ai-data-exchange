#!/usr/bin/env node
/**
 * Skeleton GSOC event processor.
 *
 * Subscribes to a GSOC channel on a Bee node and hands every received message
 * to `handleMessage`. The handler is a placeholder — wire real processing in
 * there when ready.
 */
import 'dotenv/config';
import { Bee, Bytes, Identifier, PrivateKey } from '@ethersphere/bee-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`missing required env var: ${name}`);
  }
  return value.trim();
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
}

async function handleMessage(message: Bytes): Promise<void> {
  // TODO: real processing goes here.
  console.log(`[gsoc] received ${JSON.stringify(message)}`);
}

function main(): void {
  const beeUrl = requireEnv('GSOC_BEE_URL');
  const resourceId = requireEnv('GSOC_RESOURCE_ID');
  const topic = requireEnv('GSOC_TOPIC');

  const bee = new Bee(beeUrl);
  const resourceAddress = new PrivateKey(stripHexPrefix(resourceId)).publicKey().address();
  const identifier = Identifier.fromString(topic);

  const subscription = bee.gsocSubscribe(resourceAddress, identifier, {
    onMessage: (message) => {
      void handleMessage(message);
    },
    onError: (err) => {
      console.error('[gsoc] subscribe error:', err);
    },
    onClose: () => {
      console.log('[gsoc] subscription closed');
    },
  });

  console.log(`[gsoc] subscribed — bee=${beeUrl} topic=${topic}`);

  const shutdown = () => {
    subscription.cancel();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
