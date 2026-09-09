import type { Address } from 'viem';
import { useDistribute } from '../hooks/useDistribute';
import { useWallet } from '../context/WalletContext';
import TxNote from './TxNote';
import styles from './styles.module.css';

export interface DistributeButtonProps {
  splitter: Address;
  /** False when the clone holds nothing — `distribute` would no-op, so the button says so. */
  funded: boolean;
}

/**
 * Sweep one clone to its seller and the treasury.
 *
 * Gas is paid by the connected wallet, which on this dashboard is the marketplace operator. That
 * is deliberate: `distribute` is permissionless so a seller never needs to hold gas to receive
 * revenue, and never depends on the operator to reach their funds either.
 */
export default function DistributeButton({ splitter, funded }: DistributeButtonProps) {
  const { state, busy, distribute } = useDistribute(splitter);
  const { account, wrongChain } = useWallet();

  const blocked = !account || wrongChain;
  const disabled = !funded || busy || blocked;

  const title = !funded
    ? 'Nothing accrued — distribute would be a no-op'
    : !account
      ? 'Connect a wallet to distribute'
      : wrongChain
        ? 'Switch to the configured network first'
        : 'Sweep this splitter to its seller and the treasury';

  return (
    <div className={styles.actionCell}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void distribute()}
        disabled={disabled}
        title={title}
      >
        {busy ? 'Distributing…' : 'Distribute'}
      </button>
      <TxNote state={state} />
    </div>
  );
}
