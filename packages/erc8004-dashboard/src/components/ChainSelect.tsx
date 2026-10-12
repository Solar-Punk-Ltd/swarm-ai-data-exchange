import type { ChangeEvent } from 'react';
import { CHAIN, CHAIN_QUERY_PARAM, CHAIN_STORAGE_KEY, OFFERED_CHAINS } from '../constants';

/**
 * The chain whose ERC-8004 registry the dashboard lists. One entry per `VITE_CHAIN_IDS` chain.
 *
 * Changing it reloads the page: the chain and its RPC are resolved once at import, so the honest
 * way to switch is to boot again. The choice goes into the URL (so the reload and any copied link
 * land on it) and into localStorage (so the next visit does too). A single-chain build renders a
 * static label.
 */
export default function ChainSelect() {
  const style = {
    fontSize: 13,
    color: '#a9a397',
  } as const;

  if (OFFERED_CHAINS.length <= 1) {
    return <span style={style}>{CHAIN.name}</span>;
  }

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (Number(next) === CHAIN.id) return;
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
      aria-label="Chain"
      value={CHAIN.id}
      onChange={onChange}
      style={{
        ...style,
        background: 'transparent',
        border: '1px solid #3a362e',
        borderRadius: 999,
        padding: '2px 10px',
        cursor: 'pointer',
      }}
    >
      {OFFERED_CHAINS.map((chain) => (
        <option key={chain.id} value={chain.id} style={{ color: '#111' }}>
          {chain.name}
        </option>
      ))}
    </select>
  );
}
