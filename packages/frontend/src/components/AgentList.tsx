import { useAgents } from '../hooks/useAgents';

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
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {agents.map((agent) => (
        <li
          key={agent.agentId}
          style={{
            background: '#1e293b',
            borderRadius: 8,
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Agent #{agent.agentId}</span>
          <a
            href={agent.uri}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: '0.85rem', wordBreak: 'break-all' }}
          >
            {agent.uri}
          </a>
        </li>
      ))}
    </ul>
  );
}
