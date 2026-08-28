import { useWallet } from '../context/WalletContext';
import { config } from '../config/env';
import styles from './styles.module.css';

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Reads work with no wallet connected — this only gates distribution.
 *
 * Chain mismatch is a first-class state rather than a failed send: a wallet on the wrong network
 * gets a Switch action, not a rejected transaction.
 */
export default function ConnectButton() {
  const { available, account, connecting, wrongChain, connect, switchChain, error } = useWallet();

  if (!available) {
    return (
      <span className={styles.pill} title="No EIP-1193 provider found in this browser">
        No wallet detected
      </span>
    );
  }

  if (!account) {
    return (
      <>
        {error && <span className={`${styles.pill} ${styles.pillDanger}`}>{error}</span>}
        <button
          type="button"
          className={styles.button}
          onClick={() => void connect()}
          disabled={connecting}
        >
          {connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      </>
    );
  }

  if (wrongChain) {
    return (
      <>
        <span className={`${styles.pill} ${styles.pillWarn}`}>Wrong network</span>
        <button type="button" className={styles.button} onClick={() => void switchChain()}>
          Switch to {config.chain.name}
        </button>
      </>
    );
  }

  return (
    <span className={`${styles.pill} ${styles.pillSuccess}`} title={account}>
      {truncate(account)}
    </span>
  );
}
