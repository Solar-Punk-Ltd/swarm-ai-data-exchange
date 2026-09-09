import type { Address } from 'viem';
import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import { catalogUrl } from '../lib/agents';
import styles from './styles.module.css';

/**
 * Link out to this seller's Swarm catalog.
 *
 * The feed owner comes from the Agent Card's `swarm-ai-catalog` service entry, so this depends on
 * the same best-effort card fetch as the agent name — no card, no link. It renders nothing rather
 * than a dead link: a seller can legitimately hold a splitter and publish no catalog, and an
 * unfetchable card is indistinguishable from that here.
 */

function CatalogIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 5a2 2 0 0 1 2-2h4v18H6a2 2 0 0 1-2-2z" />
      <path d="M10 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8" />
      <path d="M14 8h3M14 12h3" />
    </svg>
  );
}

export default function CatalogLink({ splitter }: { splitter: Address }) {
  const { agentLinks } = useMarketplace();

  const owner = agentLinks.bySplitter.get(splitter.toLowerCase())?.card?.catalogFeedOwner;
  if (!owner) return null;

  const href = catalogUrl(owner, config.catalogueBrowserUrl, config.swarmGateway);

  return (
    <a
      className={`${styles.pill} ${styles.pillAccent} ${styles.pillLink}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Browse this seller's catalog (feed owner ${owner})`}
    >
      <CatalogIcon />
      Catalog
    </a>
  );
}
