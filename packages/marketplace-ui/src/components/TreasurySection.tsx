import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import { formatTaxBps } from '../lib/format';
import AddressLink from './AddressLink';
import Balance, { Skeleton } from './Balance';
import DistributeAllButton from './DistributeAllButton';
import styles from './styles.module.css';

export default function TreasurySection() {
  const { registry, balances } = useMarketplace();

  // The factory's treasury is the address clones actually pay into. If VITE_TREASURY_ADDRESS
  // points somewhere else, the balances on this card are not the marketplace's revenue.
  const factoryTreasury = registry?.factory.treasury;
  const mismatch =
    factoryTreasury !== undefined &&
    factoryTreasury.toLowerCase() !== config.treasury.toLowerCase();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Treasury</h2>
      </div>

      {mismatch && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          VITE_TREASURY_ADDRESS does not match the factory&rsquo;s treasury ({factoryTreasury}). New
          clones will pay into the factory&rsquo;s address, not this one.
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.sellerTop}>
          <AddressLink address={config.treasury} />
          <DistributeAllButton />
        </div>

        <div className={styles.stats}>
          {config.currencies.map((currency) => (
            <div key={currency.symbol} className={styles.stat}>
              <div className={styles.statLabel}>{currency.symbol}</div>
              <div className={styles.statValue}>
                <Balance amount={balances?.treasury[currency.symbol]} currency={currency} />
              </div>
            </div>
          ))}

          <div className={styles.stat}>
            <div className={styles.statLabel}>Default rate (new sellers)</div>
            <div className={styles.statValue}>
              {registry ? formatTaxBps(registry.factory.defaultTaxBps) : <Skeleton width={48} />}
            </div>
            {/* Existing clones freeze their own taxBps at creation, so this is not what current
                sellers necessarily pay — each seller row shows its own rate. */}
            <div className={styles.statNote}>Existing clones keep their frozen rate</div>
          </div>
        </div>
      </div>
    </section>
  );
}
