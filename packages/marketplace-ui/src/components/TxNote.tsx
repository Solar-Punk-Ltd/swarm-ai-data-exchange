import { config } from '../config/env';
import { txUrl } from '../config/chain';
import type { TxState } from '../hooks/useTxLifecycle';
import styles from './styles.module.css';

/**
 * The visible tail of the transaction state machine.
 *
 * Every non-idle state renders something. A button that has been clicked and shows nothing is the
 * worst failure mode on a presentation surface.
 */
export default function TxNote({ state }: { state: TxState }) {
  if (state.status === 'idle') return null;

  if (state.status === 'signing') {
    return <span className={styles.txNote}>Awaiting signature…</span>;
  }

  if (state.status === 'pending') {
    const href = txUrl(config.chain, state.hash);
    return (
      <span className={styles.txNote}>
        Pending
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer">
            view
          </a>
        )}
      </span>
    );
  }

  if (state.status === 'failed') {
    return (
      <span className={`${styles.txNote} ${styles.txNoteError}`} title={state.error}>
        {state.error}
      </span>
    );
  }

  const href = txUrl(config.chain, state.hash);
  return (
    <span className={`${styles.txNote} ${styles.txNoteSuccess}`}>
      {state.note ?? 'Distributed'}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer">
          view
        </a>
      )}
    </span>
  );
}
