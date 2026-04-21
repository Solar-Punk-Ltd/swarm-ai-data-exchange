import type { AgentCard } from '@solarpunk/erc8004-adapter';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../context/AgentsContext';

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
          {card && <StatusBadge active={card.active} />}
          {card?.x402Support && <span style={badgeStyle('#854d0e', '#fef08a')}>x402</span>}
        </div>
        {card?.version && (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>v{card.version}</span>
        )}
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

export default function AgentList() {
  const { agents, loading, error } = useAgents();

  if (loading) {
    return <p style={{ color: '#94a3b8' }}>Loading agents from Base Sepolia…</p>;
  }

  if (error) {
    return (
      <div style={{ color: '#f87171', background: '#1e293b', padding: '1rem', borderRadius: 8 }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (agents.length === 0) {
    return <p style={{ color: '#94a3b8' }}>No SwarmAI-capable agents found.</p>;
  }

  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {agents.map((agent) => (
        <AgentCardView key={agent.agentId} agent={agent} />
      ))}
    </ul>
  );
}
