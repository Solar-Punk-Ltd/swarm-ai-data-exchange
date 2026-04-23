/**
 * Placeholder event processor.
 *
 * Every GSOC message received by the subscriber is handed to `processEvent`.
 * Right now it just logs a summary; real processing (validation, aggregation,
 * feed write, whatever) gets wired in here later.
 *
 * Keep the return type Promise<void> so the subscriber can await serialized
 * work without caring what the processor actually does.
 */
import type { Bytes } from '@ethersphere/bee-js';
import { logger } from './logger';

export interface GsocEvent {
  /** raw message bytes as received from the GSOC channel */
  message: Bytes;
  /** Unix ms of when the event hit the subscriber */
  receivedAt: number;
}

export type GsocEventProcessor = (event: GsocEvent) => Promise<void>;

export const logOnlyProcessor: GsocEventProcessor = async (event) => {
  const hex = event.message.toHex();
  const preview = hex.length > 64 ? `${hex.slice(0, 64)}…` : hex;
  let utf8: string | null = null;
  try {
    utf8 = event.message.toUtf8();
  } catch {
    /* not utf-8-safe; skip */
  }
  logger.info(
    `event received (${event.message.length} bytes, sha=${preview})` +
      (utf8 ? ` utf8="${utf8.slice(0, 120)}${utf8.length > 120 ? '…' : ''}"` : ''),
  );
};
