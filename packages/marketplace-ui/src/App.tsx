import { configError } from './config/env';
import { MarketplaceProvider } from './context/MarketplaceContext';
import { WalletProvider } from './context/WalletContext';
import { useHashRoute } from './hooks/useHashRoute';
import type { Route } from './hooks/useHashRoute';
import AppShell from './components/AppShell';
import StaleBanner from './components/StaleBanner';
import MapPage from './components/MapPage';
import DevconPage from './components/DevconPage';
import ClaimWalletPage from './components/ClaimWalletPage';
import SellerSection from './components/SellerSection';
import TreasurySection from './components/TreasurySection';
import HistorySection from './components/HistorySection';
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

/**
 * Both records are keyed by `Route`, so widening the union is a type error until every page is
 * named here — which is the point of the lookup over a chain of ternaries.
 */
const PAGES: Record<Route, () => JSX.Element> = {
  dashboard: Dashboard,
  map: MapPage,
  devcon: DevconPage,
  'claim-wallet': ClaimWalletPage,
};

/**
 * Routing lives here, below the providers, rather than in `App`: `App` returns early when the
 * config is broken, and a hook called after that return is conditional. Nothing in this repo
 * would catch it — `eslint-plugin-react-hooks` is not installed.
 */
function Routes() {
  const route = useHashRoute();
  const Page = PAGES[route];
  return (
    <AppShell route={route} subtitle={SUBTITLES[route]}>
      <Page />
    </AppShell>
  );
}

export default function App() {
  if (configError) return <ConfigFailure problems={configError.problems} />;

  return (
    <MarketplaceProvider>
      <WalletProvider>
        <Routes />
      </WalletProvider>
    </MarketplaceProvider>
  );
}
