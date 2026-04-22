---
name: erc8004-create-agent
description: >
  Use this skill whenever an agent or user wants to register a new ERC-8004 agent on-chain
  using the @solarpunk/erc8004-adapter CLI. Triggers include: any mention of "create-agent",
  "register agent", "mint agent NFT", "ERC-8004 registration", "agent card", "Swarm agent
  registration", or requests to set up a new provider agent on Base Sepolia. Also trigger
  when the user supplies agent metadata (name, description, x402 endpoint, Swarm endpoint,
  capabilities) and wants to register it on-chain. Use this skill proactively — if someone
  describes an agent they want to deploy, assume they want to run the full registration flow.
---

# ERC-8004 `create-agent` CLI Skill

Guides end-to-end agent registration via the `pnpm create-agent` command from
`@solarpunk/erc8004-adapter`. The command: generates an Agent Card → uploads it to a
Swarm feed → mints an ERC-8004 NFT on Base Sepolia — all in one shot.

---

## Prerequisites checklist

Before constructing the command, verify or ask the user for:

| # | Item | Source |
|---|------|--------|
| 1 | **`--privateKey`** — on-chain wallet private key for minting the NFT | `--privateKey` flag OR `PRIVATE_KEY` env var |
| 2 | **`--feedPrivateKey`** — Swarm feed signing key for uploading the Agent Card | `--feedPrivateKey` flag OR `BEE_FEED_PK` env var |
| 3 | **`--name`** — human-readable agent name | `--name` flag (required) |
| 4 | **`--description`** — what the agent does | `--description` flag (required) |
| 5 | Bee node running and reachable | default `http://localhost:1633`; override with `--beeApiUrl` |

Items 1 & 2 are always required. Items 3 & 4 are required flags. Everything else is optional.

---

## Command template

### Running from within the package directory

```sh
pnpm create-agent \
  --name "<agent name>" \
  --description "<what the agent does>" \
  [--image "<avatar URL>"] \
  [--version "<semver, default 1.0.0>"] \
  [--x402 "<x402 service endpoint URL>"] \
  [--swarm "<Swarm service endpoint URL>"] \
  [--capabilities "<comma-separated tags>"] \
  [--privateKey "<0x… wallet private key>"] \
  [--feedPrivateKey "<0x… feed signing key>"] \
  [--postageBatchId "<64-char hex stamp ID>"] \
  [--beeApiUrl "<Bee node URL, default http://localhost:1633>"]
```

### Running from the monorepo root (use `--filter`)

```sh
pnpm --filter @solarpunk/erc8004-adapter create-agent \
  --name "<agent name>" \
  --description "<what the agent does>" \
  ...
```

---

## Flag reference

| Flag | Required | Default | Notes |
|------|----------|---------|-------|
| `--name` | **Yes** | — | Human-readable display name |
| `--description` | **Yes** | — | Short description of what the agent does |
| `--image` | No | Swarm placeholder avatar | URL of an avatar image |
| `--version` | No | `1.0.0` | SemVer or date string for the Agent Card revision |
| `--x402` | No | — | x402 service endpoint URL; sets `x402Support: true` on the card |
| `--swarm` | No | — | Swarm service endpoint URL |
| `--capabilities` | No | — | Comma-separated tags, e.g. `trading,price-feeds,image_generation` |
| `--privateKey` | No* | `PRIVATE_KEY` env | On-chain wallet key for the NFT mint transaction |
| `--feedPrivateKey` | No* | `BEE_FEED_PK` env | Swarm feed signing key for Agent Card upload |
| `--postageBatchId` | No | auto-discovered | 64-char hex batch ID; Bee node is queried automatically if absent |
| `--beeApiUrl` | No | `http://localhost:1633` | Bee node base URL |

\* Required in practice — just can come from env vars instead of flags.

---

## Step-by-step behaviour (what the command does internally)

```
[1/3] Agent Card — builds AgentCard JSON from flags
[2/3] Uploading to Swarm — uploads card to a Swarm feed; returns a feedUrl
         (immutable per-version bzz:// URL + mutable feed URL)
[3/3] Registering on-chain — mints ERC-8004 NFT on Base Sepolia with feedUrl as URI
```

If `BEE_FEED_PK` / `--feedPrivateKey` is absent, step 2 is **skipped** and a placeholder
`bzz://` URI is registered instead. The agent is still minted; only the Swarm upload is skipped.

---

## Reading the output

A successful run prints a JSON result block:

```json
{
  "agentId": "42",
  "txHash": "0xabc123…",
  "agentURI": "https://api.gateway.ethswarm.org/feeds/<owner>/<topic>…"
}
```

| Field | What it is |
|-------|-----------|
| `agentId` | The NFT token ID. Use this for all reputation queries and metadata lookups. |
| `txHash` | Base Sepolia transaction hash. Verify at `https://sepolia.basescan.org/tx/<txHash>` |
| `agentURI` | Swarm feed URL stored on-chain. Always resolves to the latest Agent Card version — never needs to change even after card updates. |

Newly registered agents are browsable at [8004scan.io](https://8004scan.io).

---

## Environment variable setup (`.env`)

If the user wants to avoid passing keys as flags every time, recommend:

```env
PRIVATE_KEY=0x<on-chain wallet private key>
BEE_FEED_PK=0x<swarm feed signing key>
BEE_API_URL=http://localhost:1633        # optional
BEE_POSTAGE_STAMP=<64-char hex>          # optional, auto-discovered if absent
```

Then the command simplifies to:

```sh
pnpm create-agent \
  --name "My Agent" \
  --description "Does something useful." \
  --x402 "https://my.provider.example.com/data" \
  --capabilities "trading,price-feeds"
```

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Error: missing required flag --name` | `--name` not supplied | Add `--name "…"` |
| `Error: missing required flag --description` | `--description` not supplied | Add `--description "…"` |
| `No private key` / wallet error | Neither `--privateKey` nor `PRIVATE_KEY` set | Set the flag or env var |
| Swarm upload skipped / placeholder URI | `BEE_FEED_PK` / `--feedPrivateKey` absent | Set `BEE_FEED_PK` or `--feedPrivateKey` |
| `insufficient funds` | Wallet has no testnet ETH | Fund from [Base Sepolia faucet](https://faucet.quicknode.com/base/sepolia) |
| Bee node unreachable | Bee not running or wrong URL | Start Bee or pass `--beeApiUrl` |
| No usable postage stamp | Stamp missing or expired | Run `bee stamp buy --depth 20 --amount 100` or pass `--postageBatchId` |
| Command hangs after "Sending transaction…" | Waiting for block confirmation | Normal — Base Sepolia can take up to ~30 s |

---

## Full worked example

Registering a trading data provider with both x402 and Swarm endpoints:

```sh
pnpm create-agent \
  --name "Solarpunk Trading Data Agent" \
  --description "Provides real-time and historical trading data for DeFi protocols on Base." \
  --image "https://cdn.solarpunk.buzz/agents/trading-avatar.png" \
  --version "1.2.0" \
  --x402 "https://data.solarpunk.buzz/trading/v1" \
  --swarm "https://swarm.solarpunk.buzz/trading" \
  --capabilities "trading,historical-data,price-feeds" \
  --privateKey "0xac0974bec29a17e37ba4a6b4d238ff947bacb478cbed5efcae784d7bf4f2ff80" \
  --feedPrivateKey "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" \
  --beeApiUrl "http://localhost:1633"
```

> **Note:** The private keys above are the standard Hardhat/Anvil dev accounts. Never use them with real funds.

---

## After registration — next steps

Once the agent is registered, suggest these follow-up actions based on context:

1. **Update metadata** — attach capability flags on-chain:
   ```typescript
   await erc8004.identity.setMetadata(agentId, 'swarm_ai_capable', new Uint8Array([1]));
   ```

2. **Check reputation** — after data exchanges, consumers post feedback:
   ```typescript
   const rep = await erc8004.aggregate.calculateReputation(agentId);
   // { score: 92, feedbackCount: 3n, reliable: true }
   ```

3. **Update the Agent Card** — edit and re-upload to Swarm; the on-chain feed URI
   auto-resolves to the latest version without needing a new transaction.

4. **Run the integration test** — `pnpm test:sepolia` walks the full lifecycle on Base Sepolia.

---

## Deployed contract addresses (Base Sepolia)

| Registry | Address |
|----------|---------|
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Chain: Base Sepolia (testnet). Mainnet contracts are not yet configured.
