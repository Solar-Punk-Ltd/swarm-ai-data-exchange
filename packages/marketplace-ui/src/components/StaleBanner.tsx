import { useMarketplace } from '../context/MarketplaceContext';
import styles from './styles.module.css';

export default function StaleBanner() {
  const { stale, error } = useMarketplace();
  if (!stale) return null;
  return (
    <div className={`${styles.banner} ${styles.bannerDanger}`}>
      Could not refresh balances: {error}. The values below are the last ones read successfully.
    </div>
  );
}
