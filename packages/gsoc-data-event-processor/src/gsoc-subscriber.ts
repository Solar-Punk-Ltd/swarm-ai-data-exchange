/**
 * Thin wrapper around bee.gsocSubscribe that serializes message handling
 * through a tiny FIFO queue so processors don't need their own concurrency
 * control. Modelled after Solar-Punk-Ltd/swarm-stream-aggregator-js, minus
 * anything stream-specific.
 */
import { Bee, Bytes, GsocSubscription, Identifier, PrivateKey } from '@ethersphere/bee-js';
import { logger } from './logger';
import type { GsocEvent, GsocEventProcessor } from './processor';
import type { GsocConfig } from './config';

interface QueueItem {
  event: GsocEvent;
}

export interface StartGsocSubscriberArgs {
  config: GsocConfig;
  processor: GsocEventProcessor;
  concurrency?: number;
}

export interface StartedGsocSubscriber {
  subscription: GsocSubscription;
  /** Resolves once the in-flight queue is drained. Called by the SIGINT handler. */
  stop: () => Promise<void>;
}

export function startGsocSubscriber(args: StartGsocSubscriberArgs): StartedGsocSubscriber {
  const { config, processor } = args;
  const concurrency = Math.max(1, args.concurrency ?? 1);

  const bee = new Bee(config.beeUrl);
  const resourceKey = new PrivateKey(stripHexPrefix(config.resourceId));
  const resourceAddress = resourceKey.publicKey().address();
  const identifier = Identifier.fromString(config.topic);

  const queue: QueueItem[] = [];
  let inflight = 0;
  let stopping = false;
  const drainResolvers: Array<() => void> = [];

  const pump = () => {
    if (stopping && queue.length === 0 && inflight === 0) {
      drainResolvers.splice(0).forEach((resolve) => resolve());
      return;
    }
    while (inflight < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      inflight += 1;
      processor(next.event)
        .catch((err: unknown) => {
          logger.error(`processor rejected: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          inflight -= 1;
          pump();
        });
    }
  };

  const subscription = bee.gsocSubscribe(resourceAddress, identifier, {
    onMessage: (message: Bytes) => {
      if (stopping) return;
      queue.push({ event: { message, receivedAt: Date.now() } });
      pump();
    },
    onError: (err: unknown) => {
      logger.error(`gsocSubscribe error: ${err instanceof Error ? err.message : String(err)}`);
    },
    onClose: () => {
      logger.info('gsoc subscription closed by remote');
    },
  });

  logger.info(
    `subscribed: bee=${config.beeUrl} topic=${config.topic} ` +
      `resourceAddress=0x${resourceAddress.toHex()} concurrency=${concurrency}`,
  );

  return {
    subscription,
    stop: () => {
      stopping = true;
      subscription.cancel();
      if (queue.length === 0 && inflight === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        drainResolvers.push(resolve);
      });
    },
  };
}

function stripHexPrefix(value: string): string {
  if (value.startsWith('0x') || value.startsWith('0X')) return value.slice(2);
  return value;
}
