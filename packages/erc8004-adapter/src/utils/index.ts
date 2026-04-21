import { Bee } from '@ethersphere/bee-js';
import crypto from 'crypto';

export const getUploadPostageBatchId = async (
  argsPostageBatchId: string | undefined,
  bee: Bee,
): Promise<{ postageBatchId: string | null; error: string | null }> => {
  let postageBatchId = argsPostageBatchId;
  let maxRemainingSize = 0;

  if (!postageBatchId) {
    try {
      const rawPostageBatches = await bee.getPostageBatches();

      rawPostageBatches.forEach((batch) => {
        if (!batch.usable) {
          return;
        }

        const remainingSize = batch.remainingSize.toBytes();

        if (remainingSize > maxRemainingSize) {
          maxRemainingSize = remainingSize;
          postageBatchId = batch.batchID.toHex();
        }
      });
    } catch (error) {
      return {
        postageBatchId: null,
        error: 'There is no usable postage batch with capacity. ' + error,
      };
    }
  }

  if (!postageBatchId) {
    return {
      postageBatchId: null,
      error: 'There is no usable postage batch with capacity.',
    };
  }

  return {
    postageBatchId,
    error: null,
  };
};

/** Converts a hex string (with or without 0x prefix) to a Uint8Array. */
export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * Normalises a topic string to a 32-byte (64-char) hex string.
 * Already-hex topics are used as-is; anything else is SHA-256 hashed.
 */
export const normaliseTopic = (topic: string): string => {
  const stripped = topic.startsWith('0x') ? topic.slice(2) : topic;
  if (/^[0-9a-fA-F]{64}$/.test(stripped)) return stripped;
  return crypto.createHash('sha256').update(topic).digest('hex');
};
