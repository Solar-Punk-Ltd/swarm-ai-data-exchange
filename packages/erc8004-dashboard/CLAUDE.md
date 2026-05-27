# erc8004-dashboard

React UI for discovering ERC-8004 registered agents. Largely complete — do not refactor without a specific reason.

## Catalog integration touch point

The "Browse Catalog" button in `src/components/AgentList.tsx` links to `CATALOGUE_FEED_BROWSER_URL` (defined in `src/constants.ts`, defaults to `http://localhost:3001/`).

It currently passes `?owner=...&x402=...` query params. Once `erc8004-adapter` gains the `"swarm-ai-catalog"` services entry, the owner address should be read from there:

```typescript
// Read catalog feed owner from the agent's services entry
const catalogService = agent.card?.services?.find((s) => s.name === 'swarm-ai-catalog');
const catalogOwner = catalogService?.endpoint;
```

If no `"swarm-ai-catalog"` services entry exists on the agent, the "Browse Catalog" button should be hidden (the agent has no catalog).

## Everything else

The existing agent discovery, card rendering, and AddAgentModal are complete. The `AddAgentModal` does not yet have a `catalogFeedOwner` field — that is added via the `erc8004-adapter` CLI, not the dashboard UI.
