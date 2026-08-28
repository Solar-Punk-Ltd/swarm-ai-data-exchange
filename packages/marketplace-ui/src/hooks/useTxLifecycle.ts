import { useCallback, useState } from 'react';
import type { Hash, TransactionReceipt } from 'viem';
import { isUserRejection, walletErrorMessage } from '../lib/rpcError';

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
      // A dismissed signature prompt means nothing happened, so return to idle rather than
      // leaving a red error beside a button the user deliberately backed out of.
      if (isUserRejection(err)) return settle({ status: 'idle' });
      return settle({ status: 'failed', error: walletErrorMessage(err) });
    }
  }, []);

  return { state, busy: state.status === 'signing' || state.status === 'pending', reset, run };
}
