---
name: erc8004-get-agent
description: >
  Use this skill whenever a user wants to fetch, inspect, or look up a single ERC-8004 agent
  by its NFT token ID using the @solarpunk/erc8004-adapter CLI. Triggers include: any mention
  of "get-agent", "get agent", "look up agent", "fetch agent", "agent details", "agent by ID",
  "check agent", "what is agent 42", "show me agent 5102", or requests to retrieve a specific
  agent's card or URI from the Identity Registry. Also trigger when the user has an agentId
  (e.g. from a previous create-agent or discover-agents run) and wants to inspect that agent's
  current on-chain state or Agent Card. Use this skill proactively — if someone supplies a
  numeric agent ID and wants to know anything about it, assume they need get-agent.
---

# ERC-8004 `get-agent` CLI Skill

Guides single-agent lookup via the `pnpm get-agent` command from
`@solarpunk/erc8004-adapter`. The command: reads the agent's on-chain Swarm feed URI
directly from the Identity Registry → downloads the Agent Card from Swarm — returning
one JSON object.

This is a **read-only** command: no transactions are sent and no Swarm uploads occur.

---

## Prerequisites checklist

| # | Item | Source |
|---|------|--------|
| 1 | **`--agentId`** — NFT token ID of the agent to look up | `--agentId` flag (required) |
| 2 | **`--privateKey`** — wallet key for provider/signer initialization | `--privateKey` flag OR `PRIVATE_KEY` env var |

`--agentId` is always required. `--privateKey` (or `PRIVATE_KEY` env var) is required in
practice even though no transaction is sent — it is used to initialize the provider/signer
for contract queries.

---

## Command template

### Running from within the package directory

```sh
pnpm get-agent \
  --agentId <token-id> \
  [--privateKey "<0x… wallet private key>"]
```

### Running from the monorepo root (use `--filter`)

```sh
pnpm --filter @solarpunk/erc8004-adapter get-agent \
  --agentId <token-id> \
  [--privateKey "<0x… wallet private key>"]
```

---

## Flag reference

| Flag | Required | Default | Notes |
|------|----------|---------|-------|
| `--agentId` | **Yes** | — | NFT token ID to look up (e.g. `5102`) |
| `--privateKey` | No* | `PRIVATE_KEY` env | Wallet key for provider/signer initialization |

\* Required in practice — can come from `PRIVATE_KEY` env var instead.

---

## Step-by-step behaviour (what the command does internally)

```
1. Call tokenURI(agentId) on the Identity Registry → returns the on-chain Swarm feed URL
2. Fetch the Agent Card JSON from that URL via downloadAgentCard()
   — always resolves to the latest version of the card
3. Print a single JSON object: { agentId, agentURI, agentCard }
```

If the Swarm fetch fails (e.g. the card is temporarily unreachable), a warning is printed
to stderr and `agentCard` is `null` — `agentId` and `agentURI` are still returned.

If `agentId` does not exist on-chain, the script exits with a contract error:
`ERC721: invalid token ID` or equivalent.

---

## Reading the output

A successful run prints a single JSON object:

```json
{
  "agentId": "5102",
  "agentURI": "https://api.gateway.ethswarm.org/feeds/5468fb0537098ab63a8848dfc30f283894b37179/a1087ef3dd0e5c2fef60db3cdedac0d559d9b99b2cc922eb1b91bad419e45010",
  "agentCard": {
    "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    "name": "Solarpunk Trading Data Agent",
    "version": "1.0.0",
    "description": "Provides real-time and historical trading data for DeFi protocols on Base.",
    "image": "https://api.gateway.ethswarm.org/bzz/1edce577.../img/avatar.jpg",
    "services": [
      { "name": "x402", "endpoint": "https://data.solarpunk.buzz/trading/v1" },
      { "name": "a2a",  "endpoint": "https://a2a.solarpunk.buzz/trading" }
    ],
    "x402Support": true,
    "active": true,
    "capabilities": ["trading"]
  }
}
```

| Field | What it is |
|-------|-----------|
| `agentId` | The NFT token ID that was queried. |
| `agentURI` | Swarm feed URL stored on-chain. Always resolves to the latest Agent Card version. |
| `agentCard` | Parsed Agent Card fetched from Swarm, or `null` if the fetch failed. |

All registered agents are also browsable at [8004scan.io](https://8004scan.io).

---

## Environment variable setup (`.env`)

If `PRIVATE_KEY` is already set, only `--agentId` is needed:

```env
PRIVATE_KEY=0x<on-chain wallet private key>
```

Then the command simplifies to:

```sh
pnpm get-agent --agentId 5102
```

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `missing required flag --agentId` | `--agentId` not supplied | Add `--agentId <id>` |
| `ERC721: invalid token ID` | Agent with that ID does not exist | Verify the ID with `pnpm discover-agents` |
| `No private key` / wallet error | Neither `--privateKey` nor `PRIVATE_KEY` set | Set the flag or env var |
| `agentCard: null` | Swarm fetch failed (node temporarily unreachable) | Retry; check Bee node or gateway availability |

---

## Full worked example

```sh
# With --privateKey flag
pnpm get-agent \
  --agentId 5102 \
  --privateKey "0xac0974bec29a17e37ba4a6b4d238ff947bacb478cbed5efcae784d7bf4f2ff80"

# With PRIVATE_KEY already in .env
pnpm get-agent --agentId 5102

# From monorepo root
pnpm --filter @solarpunk/erc8004-adapter get-agent --agentId 5102
```

> **Note:** The private key above is the standard Hardhat/Anvil dev account and is safe to
> use as an example. Never use it with real funds.

---

## After lookup — next steps

Once you have the agent's card and URI, suggest these follow-up actions based on context:

1. **Check reputation** — evaluate the provider before paying:
   ```typescript
   const rep = await erc8004.aggregate.calculateReputation(agentId);
   // { score: 92, feedbackCount: 3n, reliable: true }
   // reliable === true when score >= 70 AND feedbackCount >= 3
   ```

2. **Read on-chain metadata** — verify capability flags:
   ```typescript
   const value = await erc8004.identity.getMetadata(agentId, 'swarm_ai_capable');
   // Uint8Array(1) [ 1 ]
   ```

3. **Initiate a data exchange** — use the `x402` or `a2a` endpoint from the agent's
   `services` array to start a purchase flow.

4. **Discover more agents** — use `pnpm discover-agents` to list all `swarm_ai_capable`
   agents if you don't have a specific ID yet.

---

## Deployed contract addresses (Base Sepolia)

| Registry | Address |
|----------|---------|
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Chain: Base Sepolia (testnet). Mainnet contracts are not yet configured.
