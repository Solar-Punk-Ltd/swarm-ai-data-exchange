import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ethers } from 'ethers';
import {
  createERC8004Client,
  downloadAgentCard,
  SWARM_AI_CAPABLE,
  type AgentCard,
} from '@solarpunk/erc8004-adapter';
import { AGENT_DISPLAY_LIMIT, RPC_URL } from '../constants';

export interface Agent {
  agentId: string;
  uri: string;
  card: AgentCard | null;
}

export interface AgentsContextValue {
  agents: Agent[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  addAgent: (card: AgentCard) => void;
  refresh: () => void;
}

export const AgentsContext = createContext<AgentsContextValue | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isRefresh = refreshKey > 0;

    if (isRefresh) {
      setRefreshing(true);
      setError(null);
    }

    async function fetchAgents() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const erc8004 = createERC8004Client({ provider, chain: 'base-sepolia' });

        const all = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);
        const capable = all
          .filter((a) => ethers.toBigInt(a.rawValue) === 1n)
          .sort((a1, a2) => (a1.agentId > a2.agentId ? -1 : 1))
          .slice(0, AGENT_DISPLAY_LIMIT);

        const initial: Agent[] = capable.map((a) => ({
          agentId: a.agentId.toString(),
          uri: a.uri,
          card: null,
        }));

        if (cancelled) return;
        setAgents(initial);
        setLoading(false);
        setRefreshing(false);

        for (const { agentId, uri } of initial) {
          downloadAgentCard(uri)
            .then((card) => {
              if (!cancelled) {
                setAgents((prev) => prev.map((a) => (a.agentId === agentId ? { ...a, card } : a)));
              }
            })
            .catch(() => {
              /* card stays null */
            });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchAgents();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function addAgent(card: AgentCard) {
    const tempId = `local-${Date.now()}`;
    setAgents((prev) => [{ agentId: tempId, uri: '', card }, ...prev]);
  }

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <AgentsContext.Provider value={{ agents, loading, refreshing, error, addAgent, refresh }}>
      {children}
    </AgentsContext.Provider>
  );
}
