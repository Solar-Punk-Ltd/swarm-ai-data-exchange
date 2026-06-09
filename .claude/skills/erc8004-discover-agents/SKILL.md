---
name: erc8004-discover-agents
description: >
  Use this skill whenever a user wants to discover, list, browse, or query ERC-8004 agents
  registered on-chain using the @solarpunk/erc8004-adapter CLI. Triggers include: any mention
  of "discover agents", "discover-agents", "find agents", "list agents", "browse registered
  agents", "swarm_ai_capable agents", "who is registered on ERC-8004", "what agents are
  available", or queries asking to inspect or evaluate on-chain agent registrations. Also
  trigger when the user wants to check which provider agents are active before initiating a
  data exchange. Use this skill proactively — if someone wants to find or audit agents on
  Base Sepolia, assume they need the full discover flow.
---

# ERC-8004 `discover-agents` CLI Skill

Guides agent discovery via the `pnpm discover-agents` command from
`@solarpunk/erc8004-adapter`. The command: scans Identity Registry events for
`swarm_ai_capable` agents → filters to those with the flag set to `1` → fetches each
agent's card from Swarm — returning a full JSON listing.

This is a **read-only** command: no transactions are sent and no Swarm uploads occur.

---

## Prerequisites checklist

| # | Item | Source |
|---|------|--------|
| 1 | **`RPC_URL`** — JSON-RPC endpoint for contract queries | `RPC_URL` env var (defaults to the Base Sepolia public RPC) |

No private key and no testnet ETH are required — discovery is read-only and uses a
provider-only client. The only input is an RPC endpoint.

---

## Command template

### Running from within the package directory

```sh
pnpm discover-agents
```

### Running from the monorepo root (use `--filter`)

```sh
pnpm --filter @solarpunk/erc8004-adapter discover-agents
```

---

## Flag reference

This command takes no flags. It reads `RPC_URL` from the environment (falling back to the
Base Sepolia public RPC) and queries the registry read-only.

---

## Step-by-step behaviour (what the command does internally)

```
1. Scan MetadataSet events on the Identity Registry for key swarm_ai_capable
   — deduplicates to the latest value per agentId
2. Filter to agents whose value equals 1 (capability active)
3. For each matching agent, fetch the Agent Card JSON from the Swarm feed URL stored on-chain
4. Print a JSON array: [{ agentId, agentURI, agentCard }, …]
```

If a Swarm fetch fails for a specific agent, a warning is printed to stderr and
`agentCard` is `null` for that entry — the rest of the results are still returned.

---

## Reading the output

A successful run prints a JSON array:

```json
[
  {
    "agentId": "41",
    "agentURI": "https://api.gateway.ethswarm.org/feeds/<owner>/<topic>…",
    "agentCard": {
      "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      "name": "Solarpunk Weather Data Agent",
      "version": "1.0.0",
      "description": "Provides historical and real-time weather data for on-chain applications.",
      "services": [
        { "name": "x402", "endpoint": "https://data.solarpunk.buzz/weather/v1" },
        { "name": "swarm-ai-catalog", "endpoint": "0x5468Fb0537098aB63A8848dfC30f283894B37179" }
      ],
      "x402Support": true,
      "active": true,
      "capabilities": ["weather", "historical-data"]
    }
  }
]
```

| Field | What it is |
|-------|-----------|
| `agentId` | The NFT token ID in the Identity Registry. Use for reputation queries and metadata lookups. |
| `agentURI` | Swarm feed URL stored on-chain. Always resolves to the latest Agent Card version. |
| `agentCard` | Parsed Agent Card fetched from Swarm, or `null` if the fetch failed. |

All registered agents are also browsable at [8004scan.io](https://8004scan.io).

---

## Environment variable setup (`.env`)

Only the RPC endpoint is read, and it defaults to the Base Sepolia public RPC. Set it
explicitly only to use a different/faster provider:

```env
RPC_URL=https://sepolia.base.org
```

The command takes no flags:

```sh
pnpm discover-agents
```

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `agentCard: null` for some agents | Swarm fetch failed (node temporarily unreachable) | Retry; check Bee node or gateway availability |
| Empty results array `[]` | No agents with `swarm_ai_capable = 1` in the scanned block range | Register an agent first with `pnpm create-agent`; the scan only covers recent blocks |
| RPC timeout / `query exceeds max block range` | Provider caps `eth_getLogs` range | The scan chunks into 2,000-block windows; use an RPC with a higher limit if it persists |

---

## Full worked example

```sh
# From within the package directory
pnpm discover-agents

# From monorepo root
pnpm --filter @solarpunk/erc8004-adapter discover-agents
```

---

## After discovery — next steps

Once you have the agent list, suggest these follow-up actions based on context:

1. **Check reputation** — evaluate a provider before paying:
   ```typescript
   const rep = await erc8004.aggregate.calculateReputation(agentId);
   // { score: 92, feedbackCount: 3n, reliable: true }
   // reliable === true when score >= 70 AND feedbackCount >= 3
   ```

2. **Read agent metadata** — verify on-chain capability flags:
   ```typescript
   const value = await erc8004.identity.getMetadata(agentId, 'swarm_ai_capable');
   // Uint8Array(1) [ 1 ]
   ```

3. **Initiate a data exchange** — use the `x402` endpoint to start a purchase flow, or the
   `swarm-ai-catalog` entry's `endpoint` (the catalog feed owner address) to browse the
   agent's catalog.

4. **Register your own agent** — use `pnpm create-agent` to join the registry.

---

## Deployed contract addresses (Base Sepolia)

| Registry | Address |
|----------|---------|
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Chain: Base Sepolia (testnet). Mainnet contracts are not yet configured.
