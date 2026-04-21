import { useContext } from 'react';
import { AgentsContext, type AgentsContextValue } from '../context/AgentsContext';

export function useAgents(): AgentsContextValue {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error('useAgents must be used within AgentsProvider');
  return ctx;
}
