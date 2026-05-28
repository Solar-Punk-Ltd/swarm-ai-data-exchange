# erc8004-dashboard

React UI for discovering ERC-8004 registered agents. Largely complete — do not refactor without a specific reason.

## Catalog integration fix needed (not complete)

The "Browse Catalog" button in `src/components/AgentList.tsx` currently derives the catalog owner by parsing the `swarm` service endpoint URL through `extractOwner()` (which splits `https://gateway.ethswarm.org/feeds/<owner>/<topic>` and extracts the owner segment). This is **semantically wrong**.

The catalog feed owner is a separate EOA stored directly as the `endpoint` of the `"swarm-ai-catalog"` services entry. It is not derivable from the Agent Card's Swarm feed URL — they are different keys by design (cold catalog signer vs Agent Card signer).

**Fix in `src/components/AgentList.tsx`** — replace the `ownerVar` derivation:

```typescript
// Current (wrong): parses swarm endpoint URL to guess an owner
const swarmEndpoint = card?.services.find((s) => s.name === 'swarm')?.endpoint ?? '';
const ownerVar = extractOwner(swarmEndpoint);

// Fixed: read catalog feed owner directly from the services entry
const catalogService = card?.services?.find((s) => s.name === 'swarm-ai-catalog');
const ownerVar = catalogService?.endpoint ?? '';
```

The `browseUrl` condition stays the same — it's already `null` when `ownerVar` is empty, so the button hides automatically for agents without a `"swarm-ai-catalog"` services entry.

## Everything else

The existing agent discovery, card rendering, and AddAgentModal are complete. The `AddAgentModal` does not yet have a `catalogFeedOwner` field — that is added via the `erc8004-adapter` CLI, not the dashboard UI.
