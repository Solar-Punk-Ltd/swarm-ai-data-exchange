import { useState } from 'react';
import type { AgentCard } from '@solarpunk/erc8004-adapter';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../context/AgentsContext';
import AddAgentModal from './AddAgentModal';
import { CATALOGUE_FEED_BROWSER_URL } from '../constants';

// ────────────────────────────────────────────────────────────────────
// Design tokens — orange / warm-dark-grey / off-white
// ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0b0d10',
  card: '#16191e',
  cardHi: '#1c2026',
  border: '#262a31',
  borderHi: '#3a3f48',
  text: '#f1ede4',
  text2: '#a9a397',
  text3: '#6a6557',
  orange: '#f5a524',
  orangeHi: '#fbbf24',
  orangeBg: 'rgba(245, 165, 36, 0.12)',
  orangeBd: 'rgba(245, 165, 36, 0.32)',
  green: '#22c55e',
  greenBg: 'rgba(34, 197, 94, 0.12)',
  greenBd: 'rgba(34, 197, 94, 0.30)',
  red: '#ef4444',
  redBg: 'rgba(239, 68, 68, 0.10)',
  redBd: 'rgba(239, 68, 68, 0.30)',
};

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function extractOwner(swarmEndpoint: string): string {
  try {
    const { pathname } = new URL(swarmEndpoint);
    const parts = pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('feeds');
    return idx !== -1 ? (parts[idx + 1] ?? '') : '';
  } catch {
    return '';
  }
}

/** Pull the feed identifier (hash-like) out of a Swarm endpoint URL for display. */
function extractFeedId(swarmEndpoint: string): string {
  try {
    const { pathname } = new URL(swarmEndpoint);
    const parts = pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('feeds');
    // prefer the topic segment (parts[idx+2]); fall back to owner
    return parts[idx + 2] ?? parts[idx + 1] ?? '';
  } catch {
    return '';
  }
}

function shortHash(h: string): string {
  if (!h) return '';
  if (h.length <= 12) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

// ────────────────────────────────────────────────────────────────────
// Icons
// ────────────────────────────────────────────────────────────────────
function IconSwarm(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={12} height={12} {...props}>
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="3" cy="6.5" r="1.2" />
      <circle cx="13" cy="6.5" r="1.2" />
      <circle cx="5" cy="11.5" r="1.2" />
      <circle cx="11" cy="11.5" r="1.2" />
      <circle cx="8" cy="8.5" r="1.4" />
    </svg>
  );
}
function IconExt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={12}
      height={12}
      {...props}
    >
      <path d="M6 3H3v10h10v-3" />
      <path d="M9 3h4v4" />
      <path d="M13 3 7 9" />
    </svg>
  );
}
function IconArrow(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={12}
      height={12}
      {...props}
    >
      <path d="M3 8h10" />
      <path d="m9 4 4 4-4 4" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pieces
// ────────────────────────────────────────────────────────────────────
function FeedPill({ hash, href }: { hash: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Swarm feed: ${hash}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: C.orangeBg,
        border: `1px solid ${C.orangeBd}`,
        borderRadius: 6,
        overflow: 'hidden',
        textDecoration: 'none',
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 700,
          color: C.orange,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderRight: `1px solid ${C.orangeBd}`,
        }}
      >
        <IconSwarm /> Swarm Feed
      </span>
      {hash && (
        <span
          style={{
            padding: '6px 10px',
            fontFamily: MONO,
            fontSize: 12,
            color: C.text2,
            whiteSpace: 'nowrap',
          }}
        >
          {shortHash(hash)}
        </span>
      )}
      <span
        style={{
          padding: '6px 10px 6px 0',
          color: C.text3,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <IconExt />
      </span>
    </a>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 4,
        letterSpacing: '0.02em',
        lineHeight: 1.4,
        background: active ? C.greenBg : C.redBg,
        color: active ? C.green : C.red,
        border: `1px solid ${active ? C.greenBd : C.redBd}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? C.green : C.red,
          boxShadow: active ? `0 0 0 3px rgba(34,197,94,0.18)` : 'none',
        }}
      />
      {active ? 'active' : 'inactive'}
    </span>
  );
}

function X402Badge() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: 4,
        background: C.orange,
        color: '#1a1206',
        letterSpacing: '0.02em',
      }}
    >
      x402
    </span>
  );
}

function Tag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 4,
        lineHeight: 1.5,
        background: accent ? C.orangeBg : '#111317',
        border: `1px solid ${accent ? C.orangeBd : C.border}`,
        color: accent ? C.orange : C.text,
      }}
    >
      {children}
    </span>
  );
}

function MetaGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: C.text3,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Card
// ────────────────────────────────────────────────────────────────────
function AgentCardView({ agent }: { agent: Agent }) {
  const { card, agentId, uri } = agent;
  const isDraft = agentId.startsWith('local-');

  const x402Endpoint = card?.services.find((s) => s.name === 'x402')?.endpoint ?? '';
  const swarmEndpoint = card?.services.find((s) => s.name === 'swarm')?.endpoint ?? '';
  const ownerVar = extractOwner(swarmEndpoint);
  const feedId = extractFeedId(swarmEndpoint);
  const browseUrl =
    x402Endpoint && ownerVar
      ? `${CATALOGUE_FEED_BROWSER_URL}?owner=${ownerVar}&x402=${encodeURIComponent(x402Endpoint)}`
      : null;

  return (
    <li
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 20,
        display: 'grid',
        gridTemplateColumns: '144px 1fr',
        gap: 20,
        transition: 'border-color 160ms, background 160ms',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 144,
          height: 144,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          background: '#0a0c0f',
          border: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        {card?.image ? (
          <img
            src={card.image}
            alt={card.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.text3,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.12em',
            }}
          >
            NO IMAGE
          </div>
        )}
        {!isDraft && (
          <span
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              background: 'rgba(8,10,16,0.78)',
              backdropFilter: 'blur(6px)',
              color: C.text,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 7px',
              borderRadius: 5,
              letterSpacing: '0.02em',
            }}
          >
            #{agentId}
          </span>
        )}
        {isDraft && (
          <span
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              background: 'rgba(8,10,16,0.78)',
              color: C.orange,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 7px',
              borderRadius: 5,
            }}
          >
            draft
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Row 1: name + badges + version */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: '-0.005em' }}>
            {card?.name ?? `Agent #${agentId}`}
          </span>
          {card && <StatusBadge active={card.active} />}
          {card?.x402Support && <X402Badge />}
          <span style={{ flex: 1 }} />
          {card?.version && (
            <span style={{ fontSize: 12, color: C.text3, fontFamily: MONO }}>v{card.version}</span>
          )}
        </div>

        {/* Description */}
        {card ? (
          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.55, maxWidth: '60ch' }}>
            {card.description}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: C.text3, fontStyle: 'italic' }}>Fetching card data…</p>
        )}

        {/* Swarm feed pill */}
        {(uri || swarmEndpoint) && (
          <FeedPill hash={feedId || extractFeedId(uri)} href={uri || swarmEndpoint} />
        )}

        {/* Meta strip: services / capabilities / trust */}
        {card && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px 14px',
              paddingTop: 4,
            }}
          >
            {card.services.length > 0 && (
              <MetaGroup label="Services">
                {card.services.map((s, i) => (
                  <Tag key={i}>
                    {s.name}
                    {s.version ? ` ${s.version}` : ''}
                  </Tag>
                ))}
              </MetaGroup>
            )}
            {card.capabilities && card.capabilities.length > 0 && (
              <MetaGroup label="Capabilities">
                {card.capabilities.map((c, i) => (
                  <Tag key={i}>{c}</Tag>
                ))}
              </MetaGroup>
            )}
            {card.supportedTrust && card.supportedTrust.length > 0 && (
              <MetaGroup label="Trust">
                {card.supportedTrust.map((t, i) => (
                  <Tag key={i} accent>
                    {t}
                  </Tag>
                ))}
              </MetaGroup>
            )}
          </div>
        )}

        {/* Footer: Browse button */}
        {browseUrl && (
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              justifyContent: 'flex-end',
              paddingTop: 8,
            }}
          >
            <a
              href={browseUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: C.orange,
                color: '#1a1206',
                border: `1px solid ${C.orange}`,
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.04em',
                borderRadius: 6,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Browse Catalog <IconArrow />
            </a>
          </div>
        )}
      </div>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sort helper (unchanged)
// ────────────────────────────────────────────────────────────────────
function sortedDescending(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aLocal = a.agentId.startsWith('local-');
    const bLocal = b.agentId.startsWith('local-');
    if (aLocal && bLocal) return 0;
    if (aLocal) return -1;
    if (bLocal) return 1;
    return Number(BigInt(b.agentId) - BigInt(a.agentId));
  });
}

// ────────────────────────────────────────────────────────────────────
// Top-level list
// ────────────────────────────────────────────────────────────────────
export default function AgentList() {
  const { agents, loading, refreshing, error, addAgent, refresh } = useAgents();
  const [showModal, setShowModal] = useState(false);

  function handleSave(card: AgentCard) {
    addAgent(card);
    setShowModal(false);
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            background: 'transparent',
            border: `1px solid ${C.border}`,
            color: refreshing ? C.text3 : C.text2,
            borderRadius: 6,
            padding: '9px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: refreshing ? 'default' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: C.orange,
            border: `1px solid ${C.orange}`,
            color: '#1a1206',
            borderRadius: 6,
            padding: '9px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Agent
        </button>
      </div>

      {loading && <p style={{ color: C.text2 }}>Loading agents from Base Sepolia…</p>}

      {error && (
        <div
          style={{
            color: C.red,
            background: C.card,
            padding: 16,
            borderRadius: 8,
            border: `1px solid ${C.redBd}`,
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && agents.length === 0 && (
        <p style={{ color: C.text2 }}>No SwarmAI-capable agents found.</p>
      )}

      {agents.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 0,
            margin: 0,
          }}
        >
          {sortedDescending(agents).map((agent) => (
            <AgentCardView key={agent.agentId} agent={agent} />
          ))}
        </ul>
      )}

      {showModal && <AddAgentModal onClose={() => setShowModal(false)} onSave={handleSave} />}
    </>
  );
}
