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
| 1 | **`--privateKey`** — wallet key used to initialize the provider for contract queries | `--privateKey` flag OR `PRIVATE_KEY` env var |

Only a private key is needed (for provider/signer initialization). No testnet ETH is
required since no transactions are sent.

---

## Command template

### Running from within the package directory

```sh
pnpm discover-agents [--privateKey "<0x… wallet private key>"]
```

### Running from the monorepo root (use `--filter`)

```sh
pnpm --filter @solarpunk/erc8004-adapter discover-agents \
  [--privateKey "<0x… wallet private key>"]
```

---

## Flag reference

| Flag | Required | Default | Notes |
|------|----------|---------|-------|
| `--privateKey` | No* | `PRIVATE_KEY` env | Wallet key for provider/signer initialization |

\* Required in practice — can come from `PRIVATE_KEY` env var instead. With `PRIVATE_KEY` set
in `.env`, no flags are needed at all.

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
        { "name": "swarm",  "endpoint": "https://swarm.solarpunk.buzz/weather" }
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

If `PRIVATE_KEY` is already set, no flags are needed at all:

```env
PRIVATE_KEY=0x<on-chain wallet private key>
```

Then the command simplifies to:

```sh
pnpm discover-agents
```

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `No private key` / wallet error | Neither `--privateKey` nor `PRIVATE_KEY` set | Set the flag or env var |
| `agentCard: null` for some agents | Swarm fetch failed (node temporarily unreachable) | Retry; check Bee node or gateway availability |
| Empty results array `[]` | No agents with `swarm_ai_capable = 1` found | Register an agent first with `pnpm create-agent` |
| RPC timeout / slow scan | Large block range to scan | Normal on Base Sepolia — can take a few seconds |

---

## Full worked example

```sh
# With --privateKey flag
pnpm discover-agents \
  --privateKey "0xac0974bec29a17e37ba4a6b4d238ff947bacb478cbed5efcae784d7bf4f2ff80"

# With PRIVATE_KEY already in .env
pnpm discover-agents

# From monorepo root
pnpm --filter @solarpunk/erc8004-adapter discover-agents \
  --privateKey "0xac0974bec29a17e37ba4a6b4d238ff947bacb478cbed5efcae784d7bf4f2ff80"
```

> **Note:** The private key above is the standard Hardhat/Anvil dev account and is safe to
> use as an example. Never use it with real funds.

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

3. **Initiate a data exchange** — use the `x402` or `swarm` endpoint from the agent's
   `services` array to start a purchase flow.

4. **Register your own agent** — use `pnpm create-agent` to join the registry.

---

## Deployed contract addresses (Base Sepolia)

| Registry | Address |
|----------|---------|
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Chain: Base Sepolia (testnet). Mainnet contracts are not yet configured.
