import { configError } from './config/env';
import { MarketplaceProvider } from './context/MarketplaceContext';
import { WalletProvider } from './context/WalletContext';
import { useRoute } from './hooks/useRoute';
import type { Route } from './hooks/useRoute';
import AppShell from './components/AppShell';
import StaleBanner from './components/StaleBanner';
import MapPage from './components/MapPage';
import DevconPage from './components/DevconPage';
import ClaimWalletPage from './components/ClaimWalletPage';
import SellerSection from './components/SellerSection';
import TreasurySection from './components/TreasurySection';
import HistorySection from './components/HistorySection';
import styles from './components/styles.module.css';

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

function Dashboard() {
  return (
    <>
      <StaleBanner />
      <TreasurySection />
      <SellerSection />
      <HistorySection />
    </>
  );
}

const SUBTITLES: Record<Route, string> = {
  dashboard: 'Marketplace treasury and seller revenue',
  map: 'Agents and the payments between them',
  devcon: 'Scan to create a buyer agent',
  'claim-wallet': 'Buy a funded wallet from a seller agent',
};

const PAGES: Record<Route, () => JSX.Element> = {
  dashboard: Dashboard,
  map: MapPage,
  devcon: DevconPage,
  'claim-wallet': ClaimWalletPage,
};

const CHAIN_ROUTES: ReadonlySet<Route> = new Set<Route>(['dashboard', 'map']);

/**
 * Routing lives here, below `WalletProvider`, rather than in `App`: `App` returns early when the
 * config is broken, and a hook called after that return is conditional.
 */
function Routes() {
  const route = useRoute();
  const Page = PAGES[route];
  const onChain = CHAIN_ROUTES.has(route);

  const shell = (
    <AppShell route={route} subtitle={SUBTITLES[route]} showStatus={onChain}>
      <Page />
    </AppShell>
  );

  return onChain ? <MarketplaceProvider>{shell}</MarketplaceProvider> : shell;
}

export default function App() {
  if (configError) return <ConfigFailure problems={configError.problems} />;

  return (
    <WalletProvider>
      <Routes />
    </WalletProvider>
  );
}
