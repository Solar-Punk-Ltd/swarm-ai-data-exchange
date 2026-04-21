import AgentList from './components/AgentList';

export default function App() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        Swarm Data Exchange
      </h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Agents with{' '}
        <code style={{ background: '#1e293b', padding: '0 4px', borderRadius: 4 }}>
          SwarmAICapable
        </code>{' '}
        = 1 on Base Sepolia
      </p>
      <AgentList />
    </main>
  );
}
