import type { ReactNode } from 'react';
import { config } from '../config/env';
import { linkTo } from '../hooks/useRoute';
import type { Route } from '../hooks/useRoute';
import ConnectButton from './ConnectButton';
import StatusPills from './StatusPills';
import styles from './styles.module.css';

/**
 * `demo` entries are dropped unless VITE_SHOW_DEMO_FLOW is on. Filtered rather than conditionally
 * built so the array stays a declaration of every page there is.
 *
 * `claim-wallet` is deliberately absent: you arrive there by scanning the code on `/devcon`, so
 * no nav item highlights while you are on it.
 */
const NAV: { route: Route; label: string; demo?: boolean }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'map', label: 'Map of Agents' },
  { route: 'devcon', label: 'Devcon8', demo: true },
];

export interface AppShellProps {
  route: Route;
  /** Describes the current view. */
  subtitle: string;
  /**
   * Whether this route is wrapped in `MarketplaceProvider` — see `CHAIN_ROUTES` in `App.tsx`.
   */
  showStatus: boolean;
  children: ReactNode;
}

export default function AppShell({ route, subtitle, showStatus, children }: AppShellProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.titleAccent}>Swarm AI</span> <span>Data Exchange</span>
          </h1>
          <div className={styles.subtitle}>
            {subtitle} · {config.chain.name}
          </div>
        </div>
        <div className={styles.headerRight}>
          {showStatus && <StatusPills />}
          <ConnectButton />
        </div>
      </header>

      <nav className={styles.nav}>
        {NAV.filter((item) => !item.demo || config.showDemoFlow).map((item) => (
          <a
            key={item.route}
            className={`${styles.navItem} ${route === item.route ? styles.navItemOn : ''}`}
            {...linkTo(item.route)}
            aria-current={route === item.route ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {children}
    </main>
  );
}
