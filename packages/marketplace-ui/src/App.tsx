import { config, configError } from './config/env';
import { MarketplaceProvider, useMarketplace } from './context/MarketplaceContext';
import { WalletProvider } from './context/WalletContext';
import ConnectButton from './components/ConnectButton';
import SellerSection from './components/SellerSection';
import TreasurySection from './components/TreasurySection';
import styles from './components/styles.module.css';

/**
 * A misconfigured dashboard must refuse to boot rather than render an empty one — an empty table
 * looks like "no sellers yet", which is a legitimate state and hides the real problem.
 */
function ConfigFailure({ problems }: { problems: string[] }) {
  return (
    <div className={styles.fatal}>
      <div className={styles.fatalTitle}>Configuration error</div>
      <div>The dashboard cannot start until these are fixed:</div>
      <ul className={styles.fatalList}>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <div className={styles.fatalHint}>
        Copy <code>.env.example</code> to <code>.env</code> and fill it in. Vite only exposes
        variables prefixed with <code>VITE_</code>, and inlines them at build time — restart the dev
        server after editing.
      </div>
    </div>
  );
}

function StatusPills() {
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

function StaleBanner() {
  const { stale, error } = useMarketplace();
  if (!stale) return null;
  return (
    <div className={`${styles.banner} ${styles.bannerDanger}`}>
      Could not refresh balances: {error}. The values below are the last ones read successfully.
    </div>
  );
}

function Dashboard() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.titleAccent}>Swarm AI</span> <span>Data Exchange</span>
          </h1>
          <div className={styles.subtitle}>
            Marketplace treasury and seller revenue · {config.chain.name}
          </div>
        </div>
        <div className={styles.headerRight}>
          <StatusPills />
          <ConnectButton />
        </div>
      </header>

      <StaleBanner />
      <TreasurySection />
      <SellerSection />
    </main>
  );
}

export default function App() {
  if (configError) return <ConfigFailure problems={configError.problems} />;

  return (
    <MarketplaceProvider>
      <WalletProvider>
        <Dashboard />
      </WalletProvider>
    </MarketplaceProvider>
  );
}
