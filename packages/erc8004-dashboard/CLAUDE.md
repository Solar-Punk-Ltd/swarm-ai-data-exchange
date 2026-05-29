# erc8004-dashboard

React UI for discovering ERC-8004 registered agents. Largely complete — do not refactor without a specific reason.

## Catalog integration fix needed (not complete)

The "Browse Catalog" button in `src/components/AgentList.tsx` currently derives the catalog owner by parsing the `swarm` service endpoint URL through `extractOwner()` (which splits `https://gateway.ethswarm.org/feeds/<owner>/<topic>` and extracts the owner segment). This is **semantically wrong**.

The catalog feed owner is a separate EOA stored directly as the `endpoint` of the `"swarm-ai-catalog"` services entry. It is not derivable from the Agent Card's Swarm feed URL — they are different keys by design (cold catalog signer vs Agent Card signer).

**Fix in `src/components/AgentList.tsx`** — replace the `ownerVar` derivation and update the `browseUrl` condition:

```typescript
// Current (wrong): parses swarm endpoint URL to guess an owner, gates button on x402
const swarmEndpoint = card?.services.find((s) => s.name === 'swarm')?.endpoint ?? '';
const ownerVar = extractOwner(swarmEndpoint);
const browseUrl =
  x402Endpoint && ownerVar
    ? `${CATALOGUE_FEED_BROWSER_URL}?owner=${ownerVar}&x402=${encodeURIComponent(x402Endpoint)}`
    : null;

// Fixed: read catalog feed owner from services; browsing is free so only ownerVar is required
const catalogService = card?.services?.find((s) => s.name === 'swarm-ai-catalog');
const ownerVar = catalogService?.endpoint ?? '';
const browseUrl = ownerVar
  ? `${CATALOGUE_FEED_BROWSER_URL}?owner=${ownerVar}${x402Endpoint ? `&x402=${encodeURIComponent(x402Endpoint)}` : ''}`
  : null;
```

The button hides automatically when `ownerVar` is empty (no `"swarm-ai-catalog"` services entry). The `x402` query param is included when available so the browser can pre-fill the purchase endpoint, but it is not required — catalog browsing and sample preview are free per the spec (§3.2, server minimization: discovery happens via direct Swarm reads).

## swarm service entry is being removed

The `swarm` service entry on Agent Cards is being superseded. The catalog feed URL is now fully determined by the `"swarm-ai-catalog"` service entry alone:

```
catalog feed URL = feeds/<swarm-ai-catalog.endpoint>/<keccak256("swarm-ai-catalog.v1")>
```

Consequences for `src/components/AgentList.tsx`:

- `swarmEndpoint`, `extractOwner()`, and `extractFeedId()` calls become dead code — remove them
- `FeedPill` should use `uri` (the on-chain agentURI — the Agent Card's own Swarm feed URL) directly, not `swarmEndpoint`
- The `ownerVar` and `browseUrl` already use `swarm-ai-catalog` after the fix above

## Everything else

The existing agent discovery, card rendering, and AddAgentModal are complete. The `AddAgentModal` does not yet have a `catalogFeedOwner` field — that is added via the `erc8004-adapter` CLI, not the dashboard UI.
