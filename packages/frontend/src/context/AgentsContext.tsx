import { createContext, useEffect, useState, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { createERC8004Client, SWARM_AI_CAPABLE } from '@solarpunk/erc8004-adapter';
import { RPC_URL } from '../constants';

export interface Agent {
  agentId: string;
  uri: string;
}

export interface AgentsContextValue {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

export const AgentsContext = createContext<AgentsContextValue | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
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

  return (
    <AgentsContext.Provider value={{ agents, loading, error }}>{children}</AgentsContext.Provider>
  );
}
