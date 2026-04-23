#!/usr/bin/env node
/**
 * Skeleton GSOC event processor entrypoint.
 *
 * Responsibilities (current slice):
 *   - Read config from env (GSOC_BEE_URL, GSOC_RESOURCE_ID, GSOC_TOPIC).
 *   - Subscribe to the GSOC channel via bee-js.
 *   - Hand every received message to a pluggable processor.
 *   - Clean shutdown on SIGINT/SIGTERM (drain queue, cancel subscription).
 *
 * Processing logic is intentionally a placeholder (logOnlyProcessor). Wire the
 * real handler into `startGsocSubscriber({ processor })` when you're ready.
 */
import { loadConfig } from './config';
import { startGsocSubscriber } from './gsoc-subscriber';
import { logger } from './logger';
import { logOnlyProcessor } from './processor';

export { loadConfig } from './config';
export {
  startGsocSubscriber,
  type StartGsocSubscriberArgs,
  type StartedGsocSubscriber,
} from './gsoc-subscriber';
export { type GsocEvent, type GsocEventProcessor, logOnlyProcessor } from './processor';
export { logger } from './logger';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info('starting');

  const subscriber = startGsocSubscriber({
    config: config.gsoc,
    processor: logOnlyProcessor,
    concurrency: config.queueConcurrency,
  });

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    try {
      await subscriber.stop();
      logger.info('drained, exiting');
      process.exit(0);
    } catch (err) {
      logger.error(`error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`uncaught exception: ${err.message}`);
    logger.error(err.stack ?? '');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });

  logger.info('running — waiting for GSOC messages (Ctrl+C to stop)');
}

// Only run main() when this file is the entry point, not when imported as a
// library. Using require.main works in CommonJS output (tsc default).
if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gsoc-data-event-processor] fatal: ${msg}`);
    process.exit(1);
  });
}
