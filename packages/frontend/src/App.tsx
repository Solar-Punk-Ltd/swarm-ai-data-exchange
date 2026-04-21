import { AgentsProvider } from './context/AgentsContext';
import AgentList from './components/AgentList';

export default function App() {
  return (
    <AgentsProvider>
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          Swarm AI Data Exchange
        </h1>
        <AgentList />
      </main>
    </AgentsProvider>
  );
}
