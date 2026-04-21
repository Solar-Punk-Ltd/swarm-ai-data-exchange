import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { createERC8004Client, SWARM_AI_CAPABLE } from '@solarpunk/erc8004-adapter';

interface Agent {
  agentId: string;
  uri: string;
}

const RPC_URL = 'https://sepolia.base.org';

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const erc8004 = createERC8004Client({ provider, chain: 'base-sepolia' });

        const all = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);
        const capable = all.filter((a) => ethers.toBigInt(a.rawValue) === 1n);

        if (!cancelled) {
          setAgents(capable.map((a) => ({ agentId: a.agentId.toString(), uri: a.uri })));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAgents();
    return () => {
      cancelled = true;
    };
  }, []);

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
