import type { ReactNode } from 'react';
import { config } from '../config/env';
import type { Route } from '../hooks/useHashRoute';
import ConnectButton from './ConnectButton';
import StatusPills from './StatusPills';
import styles from './styles.module.css';

const NAV: { route: Route; href: string; label: string }[] = [
  { route: 'dashboard', href: '#/', label: 'Dashboard' },
  { route: 'map', href: '#/map', label: 'Map of Agents' },
];

export interface AppShellProps {
  route: Route;
  /** Describes the current view. The wordmark above it is fixed and matches the sibling dashboard. */
  subtitle: string;
  children: ReactNode;
}

/**
 * Page chrome shared by both views: wordmark, per-view subtitle, status/wallet controls, and the
 * nav. Plain anchors rather than click handlers, so the hash is the single source of route truth
 * and Back works without the router pushing anything itself.
 */
export default function AppShell({ route, subtitle, children }: AppShellProps) {
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
          <StatusPills />
          <ConnectButton />
        </div>
      </header>

      <nav className={styles.nav}>
        {NAV.map((item) => (
          <a
            key={item.route}
            className={`${styles.navItem} ${route === item.route ? styles.navItemOn : ''}`}
            href={item.href}
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
