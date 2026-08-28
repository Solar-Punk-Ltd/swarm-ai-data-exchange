import { useMarketplace } from '../context/MarketplaceContext';
import SellerRow from './SellerRow';
import styles from './styles.module.css';

/** Skeleton cards on first load, so a real zero never looks like an unloaded value. */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.sellerCard}>
          <div className={styles.sellerTop}>
            <span className={styles.skeleton} style={{ minWidth: 160 }} />
            <span className={styles.skeleton} style={{ minWidth: 120 }} />
          </div>
          <div className={styles.splitterRow}>
            <span className={styles.skeleton} style={{ minWidth: 180 }} />
            <span className={styles.skeleton} style={{ minWidth: 90 }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function SellerSection() {
  const { registry, loading, fundedSplitters } = useMarketplace();

  const sellers = registry?.sellers ?? [];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Sellers</h2>
        {registry && (
          <span className={styles.sectionMeta}>
            {sellers.length} registered · {fundedSplitters.length} funded
          </span>
        )}
      </div>

      {loading && !registry ? (
        <LoadingRows />
      ) : sellers.length === 0 ? (
        // splitterCount === 0 is the normal state on a fresh factory, not an error.
        <div className={styles.empty}>
          No sellers have deployed a splitter yet. A seller creates their own clone before listing,
          so this fills in as agents onboard.
        </div>
      ) : (
        sellers.map((record) => <SellerRow key={record.splitter} record={record} />)
      )}
    </section>
  );
}
