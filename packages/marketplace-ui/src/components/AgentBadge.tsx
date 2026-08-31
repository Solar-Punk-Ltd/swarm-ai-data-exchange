import type { Address } from 'viem';
import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import type { AgentLink } from '../lib/agents';
import styles from './styles.module.css';

/**
 * Which ERC-8004 agent owns this clone.
 *
 * The link is a claim written by the agent owner, so the badge reports how far it has been
 * verified rather than presenting every claim as fact. See lib/agents.ts for the two checks.
 *
 * The agent's name comes from its Agent Card, fetched best-effort from a Swarm gateway. When
 * that fails the badge still shows the id — a missing name is a degraded label, never a
 * missing agent.
 */

function CardIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/** `Copy-Trading Alpha · Agent #9096`, or just the id when no card resolved. */
function label(link: AgentLink): string {
  const id = `Agent #${link.agentId.toString()}`;
  return link.card?.name ? `${link.card.name} · ${id}` : id;
}

function CardLink({ link }: { link: AgentLink }) {
  const href = link.card?.url;
  if (!href) return null;
  return (
    <a
      className={styles.iconButton}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the Agent Card"
      title="Open the Agent Card"
    >
      <CardIcon />
    </a>
  );
}

export default function AgentBadge({ splitter, seller }: { splitter: Address; seller: Address }) {
  const { agentLinks } = useMarketplace();

  if (!config.identityRegistry) return null;

  const link = agentLinks.bySplitter.get(splitter.toLowerCase());

  if (!link) {
    // A cut-short log sweep means absence proves nothing, so claim nothing.
    if (agentLinks.partial) return null;
    return (
      <span className={styles.pill} title="No ERC-8004 agent has linked this splitter">
        No agent linked
      </span>
    );
  }

  const description = link.card?.description ? `\n\n${link.card.description}` : '';

  if (link.status === 'disputed') {
    return (
      <span className={`${styles.pill} ${styles.pillDanger} ${styles.pillClamp}`}>
        <span
          title={`More than one agent claims this splitter. None can be trusted without an off-chain check.${description}`}
        >
          {label(link)} · disputed
        </span>
        <CardLink link={link} />
      </span>
    );
  }

  if (link.status === 'unverified') {
    return (
      <span className={`${styles.pill} ${styles.pillWarn} ${styles.pillClamp}`}>
        <span
          title={
            `Agent ${link.agentId} claims this splitter, but the clone's seller (${seller}) is ` +
            `neither its registered wallet (${link.agentWallet ?? 'unset'}) nor its NFT owner ` +
            `(${link.owner ?? 'unknown'}).${description}`
          }
        >
          {label(link)} · unverified
        </span>
        <CardLink link={link} />
      </span>
    );
  }

  return (
    <span className={`${styles.pill} ${styles.pillSuccess} ${styles.pillClamp}`}>
      <span
        title={`Verified: the clone's seller matches agent ${link.agentId}'s ${
          link.agentWallet?.toLowerCase() === seller.toLowerCase()
            ? 'registered wallet'
            : 'NFT owner'
        }.${description}`}
      >
        {label(link)}
      </span>
      <CardLink link={link} />
    </span>
  );
}
