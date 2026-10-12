import type { ChangeEvent } from 'react';
import { CHAIN_QUERY_PARAM, CHAIN_STORAGE_KEY, config } from '../config/env';
import styles from './styles.module.css';

/**
 * The chain the dashboard reads. One entry per `VITE_CHAIN_IDS` chain.
 *
 * Changing it reloads the page rather than swapping state: `config` is a module singleton that
 * every component and both contexts read at import, so the honest way to change it is to boot
 * again with the new choice. The choice is written to the URL first (so the reload — and any copied
 * link — lands on the same chain) and to localStorage (so the next visit does too).
 *
 * A single-chain build renders a static label instead of a one-option dropdown.
 */
export default function ChainSelect() {
  if (config.chains.length <= 1) {
    return <span className={styles.chainLabel}>{config.chain.name}</span>;
  }

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (Number(next) === config.chain.id) return;
    try {
      window.localStorage.setItem(CHAIN_STORAGE_KEY, next);
    } catch {
      // Blocked storage only costs the memory between visits; the URL still carries the choice.
    }
    const url = new URL(window.location.href);
    url.searchParams.set(CHAIN_QUERY_PARAM, next);
    window.history.replaceState(null, '', url);
    window.location.reload();
  };

  return (
    <select
      className={styles.select}
      aria-label="Chain"
      value={config.chain.id}
      onChange={onChange}
    >
      {config.chains.map((chain) => (
        <option key={chain.id} value={chain.id}>
          {chain.name}
        </option>
      ))}
    </select>
  );
}
