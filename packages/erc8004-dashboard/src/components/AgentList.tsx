import { useState } from 'react';
import type { AgentCard } from '@solarpunk/erc8004-adapter';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../context/AgentsContext';
import AddAgentModal from './AddAgentModal';

function AgentCardView({ agent }: { agent: Agent }) {
  const { card, agentId, uri } = agent;

  return (
    <li
      style={{
        background: '#1e293b',
        borderRadius: 10,
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <Header agentId={agentId} uri={uri} card={card} />
      {card ? <Body card={card} /> : <CardSkeleton />}
    </li>
  );
}

function Header({ agentId, uri, card }: { agentId: string; uri: string; card: AgentCard | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      {card?.image && (
        <img
          src={card.image}
          alt={card.name}
          style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#f1f5f9' }}>
            {card?.name ?? `Agent #${agentId}`}
          </span>
          <span style={{ fontSize: '1rem', fontFamily: 'monospace' }}>
            {agentId.startsWith('local-') ? 'draft' : `#${agentId}`}
          </span>
          {card && <StatusBadge active={card.active} />}
          {card?.x402Support && <span style={badgeStyle('#854d0e', '#fef08a')}>x402</span>}
        </div>
        {card?.version && (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>v{card.version}</span>
        )}
        {uri && (
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.75rem',
              color: '#60a5fa',
              wordBreak: 'break-all',
              display: 'block',
              marginTop: '0.15rem',
            }}
          >
            {uri}
          </a>
        )}
      </div>
    </div>
  );
}

function Body({ card }: { card: AgentCard }) {
  return (
    <>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5 }}>
        {card.description}
      </p>

      {card.services.length > 0 && (
        <Section label="Services">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {card.services.map((svc, i) => (
              <span key={i} style={badgeStyle('#1e3a5f', '#93c5fd')}>
                {svc.name}
                {svc.version ? ` ${svc.version}` : ''}
              </span>
            ))}
          </div>
        </Section>
      )}

      {card.capabilities && card.capabilities.length > 0 && (
        <Section label="Capabilities">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {card.capabilities.map((cap, i) => (
              <span key={i} style={badgeStyle('#1a3a2a', '#86efac')}>
                {cap}
              </span>
            ))}
          </div>
        </Section>
      )}

      {card.supportedTrust && card.supportedTrust.length > 0 && (
        <Section label="Trust">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {card.supportedTrust.map((t, i) => (
              <span key={i} style={badgeStyle('#2d1b69', '#c4b5fd')}>
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <span
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={badgeStyle(active ? '#14532d' : '#3b1b1b', active ? '#86efac' : '#fca5a5')}>
      {active ? 'active' : 'inactive'}
    </span>
  );
}

function CardSkeleton() {
  return (
    <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569', fontStyle: 'italic' }}>
      Fetching card data…
    </p>
  );
}

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  };
}

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

export default function AgentList() {
  const { agents, loading, refreshing, error, addAgent, refresh } = useAgents();
  const [showModal, setShowModal] = useState(false);

  function handleSave(card: AgentCard) {
    addAgent(card);
    setShowModal(false);
  }

  return (
    <>
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}
      >
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            background: 'none',
            border: '1px solid #334155',
            color: refreshing ? '#475569' : '#94a3b8',
            borderRadius: 6,
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: refreshing ? 'default' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: '#2563eb',
            border: 'none',
            color: '#fff',
            borderRadius: 6,
            padding: '0.5rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Agent
        </button>
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading agents from Base Sepolia…</p>}

      {error && (
        <div style={{ color: '#f87171', background: '#1e293b', padding: '1rem', borderRadius: 8 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && agents.length === 0 && (
        <p style={{ color: '#94a3b8' }}>No SwarmAI-capable agents found.</p>
      )}

      {agents.length > 0 && (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {sortedDescending(agents).map((agent) => (
            <AgentCardView key={agent.agentId} agent={agent} />
          ))}
        </ul>
      )}

      {showModal && <AddAgentModal onClose={() => setShowModal(false)} onSave={handleSave} />}
    </>
  );
}
