import { AgentsProvider } from './context/AgentsContext';
import AgentList from './components/AgentList';

export default function App() {
  return (
    <AgentsProvider>
      <main style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.015em', marginBottom: 6 }}>
          <span style={{ color: '#f5a524' }}>Swarm AI</span>{' '}
          <span style={{ color: '#f1ede4' }}>Data Exchange</span>
        </h1>
        <div style={{ fontSize: 13, color: '#a9a397', marginBottom: 24 }}>
          Agents registered on ERC-8004
        </div>
        <AgentList />
      </main>
    </AgentsProvider>
  );
}
