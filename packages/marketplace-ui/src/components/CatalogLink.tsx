import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import { catalogUrl } from '../lib/agents';
import styles from './styles.module.css';

/**
 * Link out to this seller's Swarm catalog: `<gateway>/bzz/<manifest root>/catalog.jsonld`.
 *
 * The feed owner comes from the Agent Card's `swarm-ai-catalog` service entry, so this depends on
 * the same best-effort card fetch as the agent name — no card, no link. The manifest root then
 * costs a second gateway read, because the feed holds the root rather than being the catalog. So
 * the link appears a beat after the row, the way the agent name does.
 *
 * It renders nothing rather than a dead link: a seller can legitimately hold a splitter and
 * publish no catalog, and neither an unfetchable card nor an unpublished feed is distinguishable
 * from that here.
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
  const [href, setHref] = useState<string>();

  useEffect(() => {
    if (!owner) return;
    let live = true;
    void catalogUrl(owner, config.swarmGateway).then((url) => {
      if (live) setHref(url);
    });
    return () => {
      live = false;
    };
  }, [owner]);

  if (!owner || !href) return null;

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
