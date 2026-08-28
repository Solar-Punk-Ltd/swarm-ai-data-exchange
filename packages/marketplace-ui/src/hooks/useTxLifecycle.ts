import { useCallback, useState } from 'react';
import type { Hash, TransactionReceipt } from 'viem';

/**
 * The shared transaction state machine: idle → signing → pending → confirmed | failed.
 *
 * Both the per-seller Distribute button and the batch sweep run on this, so neither can drift
 * into an indeterminate state. A silently hanging button is the worst failure mode on a
 * presentation surface.
 */
export type TxState =
  | { status: 'idle' }
  | { status: 'signing' }
  | { status: 'pending'; hash: Hash }
  | { status: 'confirmed'; hash: Hash; note?: string }
  | { status: 'failed'; error: string };

export interface TxLifecycle {
  state: TxState;
  busy: boolean;
  reset: () => void;
  /**
   * `send` signs and broadcasts; `onConfirmed` may inspect the receipt and return a short note to
   * display (used to report "swept N, skipped M").
   */
  run: (
    send: () => Promise<Hash>,
    waitFor: (hash: Hash) => Promise<TransactionReceipt>,
    onConfirmed?: (receipt: TransactionReceipt) => string | undefined,
  ) => Promise<TxState>;
}

function messageOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    // viem errors carry a one-line `shortMessage` far more readable than the full `message`.
    const short = (err as { shortMessage?: unknown }).shortMessage;
    if (typeof short === 'string' && short.length > 0) return short;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message.split('\n')[0];
  }
  return String(err);
}

export function useTxLifecycle(): TxLifecycle {
  const [state, setState] = useState<TxState>({ status: 'idle' });

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  // Returns the terminal state as well as setting it, so a caller sequencing several
  // transactions can branch on the outcome instead of reading a stale `state` closure.
  const run = useCallback<TxLifecycle['run']>(async (send, waitFor, onConfirmed) => {
    const settle = (next: TxState): TxState => {
      setState(next);
      return next;
    };

    setState({ status: 'signing' });
    try {
      const hash = await send();
      setState({ status: 'pending', hash });

      const receipt = await waitFor(hash);
      if (receipt.status === 'reverted') {
        return settle({ status: 'failed', error: 'Transaction reverted on-chain.' });
      }

      return settle({ status: 'confirmed', hash, note: onConfirmed?.(receipt) });
    } catch (err) {
      return settle({ status: 'failed', error: messageOf(err) });
    }
  }, []);

  return { state, busy: state.status === 'signing' || state.status === 'pending', reset, run };
}
