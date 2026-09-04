import { useMemo, useState } from 'react';
import { useMarketplace } from '../context/MarketplaceContext';
import HistoryTable from './HistoryTable';
import styles from './styles.module.css';

type Filter = 'all' | 'purchase' | 'payout';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'purchase', label: 'Purchases' },
  { key: 'payout', label: 'Payouts' },
];

export default function HistorySection() {
  const { history, registry, loading } = useMarketplace();
  const [filter, setFilter] = useState<Filter>('all');

  const entries = useMemo(
    () => (filter === 'all' ? history.entries : history.entries.filter((e) => e.kind === filter)),
    [history.entries, filter],
  );

  const purchases = history.entries.filter((e) => e.kind === 'purchase').length;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Activity</h2>
        <span className={styles.sectionMeta}>
          {history.entries.length} event{history.entries.length === 1 ? '' : 's'} · {purchases}{' '}
          purchase{purchases === 1 ? '' : 's'}
        </span>
      </div>

      <div className={styles.historyFilters}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`${styles.historyFilter} ${filter === key ? styles.historyFilterOn : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {history.partial && (
        <div className={styles.banner}>
          History is incomplete — the log sweep was cut short, so older activity is missing. Lower
          VITE_LOG_CHUNK_BLOCKS, raise VITE_IDENTITY_REGISTRY_FROM_BLOCK, or use an RPC that allows
          wider ranges.
        </div>
      )}

      {loading && !registry ? (
        <div className={styles.historyEmpty}>Loading…</div>
      ) : (
        <HistoryTable
          entries={entries}
          emptyLabel={
            filter === 'all'
              ? 'No purchases or payouts in the scanned window yet.'
              : `No ${filter === 'purchase' ? 'purchases' : 'payouts'} in the scanned window.`
          }
          initial={12}
        />
      )}
    </section>
  );
}
