import { config } from '../config/env';
import { useMarketplace } from '../context/MarketplaceContext';
import styles from './styles.module.css';

export default function StatusPills() {
  const { stale, error, lastUpdated, loading } = useMarketplace();

  if (loading) return <span className={styles.pill}>Loading…</span>;

  if (stale) {
    return (
      <span className={`${styles.pill} ${styles.pillDanger}`} title={error}>
        Stale — showing last known values
      </span>
    );
  }

  return (
    <span className={styles.pill} title={lastUpdated ? new Date(lastUpdated).toISOString() : ''}>
      Live · {config.refreshIntervalMs / 1000}s
    </span>
  );
}
