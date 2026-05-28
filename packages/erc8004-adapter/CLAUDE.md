# erc8004-adapter

ERC-8004 identity, reputation, and Agent Card lifecycle SDK. Largely complete — see existing `src/` for the full implementation.

## Spec reference

- ERC-8004 standard: https://eips.ethereum.org/EIPS/eip-8004
- Catalog spec (for the one addition below): `../../documents/swarm-ai-catalog-design-v1_2026-05-26-final.md` §4.1 and §3.4

## One addition needed for catalog integration

The Agent Card's `services` array must support a `"swarm-ai-catalog"` entry that exposes the catalog feed owner address. This is how consumers and indexers discover the entry point for an agent's catalog (§4.1):

> "The catalog feed owner address MUST be published in the Agent Card's `services` array as an entry with name `"swarm-ai-catalog"`."

The existing `AgentService` type already has the right shape — `endpoint` carries the owner address:

```json
{
  "name": "swarm-ai-catalog",
  "endpoint": "0xabcd...1234"
}
```

### Changes required

1. **`tools/create-agent/args.ts`** — add `--catalog-feed-owner` optional argument (0x-prefixed EOA address)

2. **`tools/create-agent/index.ts`** — if `--catalog-feed-owner` is provided, append the services entry to the Agent Card before uploading:

   ```typescript
   if (args.catalogFeedOwner) {
     agentCard.services = agentCard.services || [];
     agentCard.services.push({ name: 'swarm-ai-catalog', endpoint: args.catalogFeedOwner });
   }
   ```

3. **`src/types.ts`** — no change needed; `AgentService.endpoint` already covers it. Optionally add a type guard `isCatalogService(s: AgentService): boolean`.

## Missing: registrations[] not populated post-registration

The `AgentCard.registrations` field exists in the type but is never populated. The create-agent flow currently stops after step 3 (on-chain registration) without writing the `agentId` back into the card.

The spec (§2 glossary) requires: _"All registrations are enumerated inside the Agent Card's `registrations[]` field per the ERC-8004 standard, making it the single source of truth for cross-chain and cross-registry agent identity."_

**Fix needed in `tools/create-agent/index.ts`** — add a step 4:

```typescript
// After on-chain registration returns agentId:
card.registrations = [
  {
    agentId,
    agentRegistry: `eip155:84532:${erc8004.identity.contractAddress}`, // CAIP-10 format
  },
];
// Re-upload the updated card to Swarm (same feed, same topic — overwrites)
await uploadAgentCard(card, AGENT_CARD_TOPIC, beeApiUrl, batchId, feedPk);
```

The `agentRegistry` format is CAIP-10: `eip155:<chainId>:<contractAddress>`. The chain ID and contract address are already known from `createERC8004Client`.

## Everything else

Do not change the Identity, Reputation, or AgentCard modules without a specific reason. They are complete and tested.
