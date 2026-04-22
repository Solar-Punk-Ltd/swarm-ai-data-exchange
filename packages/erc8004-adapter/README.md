# @solarpunk/erc8004-adapter

TypeScript SDK for interacting with the [ERC-8004 "Trustless Agents"](https://eips.ethereum.org/EIPS/eip-8004) on-chain registries. Provides agent identity registration, reputation feedback, and aggregated trust scoring for the Swarm Data Exchange.

This SDK is designed for autonomous agents and agent-aware services (MCPs, x402 servers, wallets) that want to integrate ERC-8004 without directly wiring raw contract calls.

> **Scope:** This package only interacts with ERC-8004-compliant registries. It does not manage Swarm uploads or x402 payment flows itself, but provides types and helpers that integrate cleanly with those layers.

---

## Overview

ERC-8004 defines on-chain registries for agent identity, reputation, and (optionally) third-party validation. This adapter covers the **Identity Registry** and **Reputation Registry** — the two components required for a working data exchange loop. The Validation Registry is optional under the spec and is not included here.

- **Identity Registry** — each agent is minted as a unique NFT. The NFT's URI points to an "Agent Card" stored on Swarm (`bzz://<hash>`), keeping metadata off-chain for gas efficiency.
- **Reputation Registry** — consumers post scored feedback (0–100) after data exchanges. Providers authorize feedback with an EIP-712 signature to prevent spoofing.

This adapter wraps both registries into three modules:

| Module       | Class              | Purpose                                                    |
| ------------ | ------------------ | ---------------------------------------------------------- |
| `identity`   | `IdentityModule`   | Register agents, manage URIs, wallets, and metadata        |
| `reputation` | `ReputationModule` | Post and read feedback, sign/verify `FeedbackAuth` tokens  |
| `aggregate`  | `AggregateModule`  | Calculate a normalized reputation score from on-chain data |

A helper module (`agent-card`) handles generating, serializing, and parsing Agent Card JSON. These helpers are **pure TypeScript** — they do not interact with the blockchain.

---

## Architecture

```
createERC8004Client(config)
        │
        ├── identity   → IdentityModule  → IdentityRegistry  (ERC-721, on Base Sepolia)
        ├── reputation → ReputationModule → ReputationRegistry (on Base Sepolia)
        └── aggregate  → AggregateModule  → wraps ReputationModule
```

The client is read-only when initialized with a `Provider`. Pass a `Signer` to enable write operations (register, postFeedback, etc.).

---

## Installation

```bash
pnpm add @solarpunk/erc8004-adapter ethers
```

---

## Quick Start

### 1. Initialize the client

```typescript
import { ethers } from 'ethers';
import { createERC8004Client } from '@solarpunk/erc8004-adapter';

const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const erc8004 = createERC8004Client({
  provider,
  signer, // omit for read-only use
  chain: 'base-sepolia',
});
```

### 2. Generate and register an agent (provider flow)

```typescript
import { generateAgentCard, uploadAgentCard } from '@solarpunk/erc8004-adapter';

// Build the Agent Card JSON
const card = generateAgentCard({
  name: 'My Data Provider',
  description: 'Sells encrypted image datasets via Swarm',
  version: '1.0.0',
  services: [
    { name: 'x402', endpoint: 'https://provider.example.com/data' },
    { name: 'A2A', endpoint: 'https://a2aURL' },
  ],
  x402Support: true,
  active: true,
  supportedTrust: ['reputation'],
  capabilities: ['Swarm', 'trading', 'image_generation'],
});

// Upload the Agent Card to a Swarm feed — reads BEE_FEED_PK, BEE_API_URL, BEE_POSTAGE_STAMP from env.
// Using a feed means the card can be updated later without changing the on-chain URI.
const { feedUrl } = await uploadAgentCard(card);

// Mint the ERC-8004 NFT with optional metadata attached at registration time
const { agentId, txHash } = await erc8004.identity.register(feedUrl, [
  { metadataKey: 'swarm_ai_capable', metadataValue: new Uint8Array([1]) },
]);
console.log('Registered agentId:', agentId.toString());
```

The agent is now discoverable by anyone querying the Identity Registry or watching for `Registered` events on-chain.

### 2b. Set or update metadata after registration

Metadata can also be written (or overwritten) any time after the NFT exists, and read back as raw bytes:

```typescript
// Write arbitrary key/value bytes on-chain (owner only)
await erc8004.identity.setMetadata(agentId, 'swarm_ai_capable', new Uint8Array([1]));

// Read it back
const value = await erc8004.identity.getMetadata(agentId, 'swarm_ai_capable');
// value is a Uint8Array — e.g. Uint8Array(1) [ 1 ]
```

The `metadataValue` is stored as raw `bytes` on-chain. Use `new Uint8Array([1])` / `new Uint8Array([0])` for boolean flags, or `ethers.toUtf8Bytes(str)` for string values.

### 3. Discover and evaluate a provider (consumer flow)

To discover all agents that have advertised a specific capability, use `findAgentsWithMetadata`. It scans `MetadataSet` events, deduplicates per agent, and returns each agent's on-chain URI alongside the raw metadata value.

```typescript
import { ethers } from 'ethers';
import { SWARM_AI_CAPABLE } from '@solarpunk/erc8004-adapter/constants';

// Find all agents that have set the swarm_ai_capable metadata key
const agents = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);

// Filter to those where the value is 1 (capability is active)
const capableAgents = agents.filter((a) => ethers.toBigInt(a.rawValue) === 1n);

console.log(`Found ${capableAgents.length} SwarmAI-capable agents`);
for (const agent of capableAgents) {
  console.log(`agentId: ${agent.agentId} — uri: ${agent.uri}`);
}
```

You can optionally scope the scan to a block range to reduce RPC calls:

```typescript
const agents = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE, 36304145);
```

Once you have a URI, read the agent's on-chain data directly:

```typescript
// Read the agent's on-chain URI and fetch the Agent Card from Swarm
const uri = await erc8004.identity.getAgentURI(agentId); // "bzz://<hash>"
const owner = await erc8004.identity.getOwner(agentId);

// Check reputation before paying
const rep = await erc8004.aggregate.calculateReputation(agentId);
console.log(`Score: ${rep.score}/100 | Reviews: ${rep.feedbackCount} | Reliable: ${rep.reliable}`);
// reliable === true when score >= 70 and feedbackCount >= 3
```

### 4. Post feedback after a data exchange

The provider must first sign a `FeedbackAuth` token authorizing the specific consumer to post a review. This prevents arbitrary or spoofed ratings.

**Provider side** (after confirming payment):

```typescript
const feedbackAuth = await erc8004.reputation.signFeedbackAuth(
  agentId,
  consumerAddress,
  3600, // token valid for 1 hour (default)
);
// Send feedbackAuth to the consumer (e.g. in the x402 response payload)
```

**Consumer side** (after verifying the downloaded data):

```typescript
// Upload a detailed review JSON to Swarm for the evidenceURI
const evidenceHash = '<swarm-hash-of-review-json>';

const txHash = await erc8004.reputation.postFeedback({
  agentId,
  score: 92, // 0–100
  tags: ['image-data', 'reliable'], // up to 2 tags
  evidenceURI: `bzz://${evidenceHash}`, // anchored on-chain as keccak256 hash
  feedbackAuth, // EIP-712 token from the provider
});
```

Future consumers can call `calculateReputation(agentId)` before purchasing to evaluate the provider's track record.

**What's next?**

- Integrate this client into your MCP server or x402 provider to automate the full data exchange loop.
- Run `pnpm test:sepolia` to walk through a complete agent lifecycle on-chain.

---

## CLI — `create-agent`

The `create-agent` script handles the full registration flow — generate card → upload to Swarm → register on-chain — in a single command, without writing any TypeScript.

```sh
pnpm create-agent [flags]
```

### Flags

| Flag               | Required | Description                                                                                                                         |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--name`           | Yes      | Human-readable agent name                                                                                                           |
| `--description`    | Yes      | Short description of what the agent does                                                                                            |
| `--image`          | No       | URL of the agent avatar image                                                                                                       |
| `--version`        | No       | Agent Card version string (default: `1.0.0`)                                                                                        |
| `--x402`           | No       | x402 service endpoint URL                                                                                                           |
| `--a2a`            | No       | A2A service endpoint URL                                                                                                            |
| `--capabilities`   | No       | Comma-separated capability tags, e.g. `trading,price-feeds`                                                                         |
| `--privateKey`     | No       | On-chain wallet private key — falls back to `PRIVATE_KEY` env var                                                                   |
| `--feedPrivateKey` | No       | Swarm feed signing key — falls back to `BEE_FEED_PK` env var                                                                        |
| `--postageBatchId` | No       | Postage stamp batch ID (64-char hex) — falls back to `BEE_POSTAGE_STAMP` env var; auto-selected from the Bee node if neither is set |
| `--beeApiUrl`      | No       | Bee node base URL — falls back to `BEE_API_URL` env var (default: `http://localhost:1633`)                                          |

`--privateKey` and `--feedPrivateKey` (or their env var equivalents) are the only values that are always required — everything else has a sensible default or is optional.

### Example

The following registers a trading data provider with both an x402 and an A2A endpoint:

```sh
pnpm create-agent \
  --name "Solarpunk Trading Data Agent" \
  --description "Provides real-time and historical trading data for DeFi protocols on Base." \
  --image "https://cdn.solarpunk.buzz/agents/trading-avatar.png" \
  --version "1.2.0" \
  --x402 "https://data.solarpunk.buzz/trading/v1" \
  --a2a "https://a2a.solarpunk.buzz/trading" \
  --capabilities "trading,historical-data,price-feeds" \
  --privateKey "0xac0974bec29a17e37ba4a6b4d238ff947bacb478cbed5efcae784d7bf4f2ff80" \
  --feedPrivateKey "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" \
  --beeApiUrl "http://localhost:1633"
```

> **Note:** The private keys above are the standard Hardhat/Anvil dev accounts and are safe to use as examples. Never use them with real funds.

### Output

The script logs each step and exits with a JSON result:

```
[1/3] Agent Card
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Solarpunk Trading Data Agent",
  "description": "Provides real-time and historical trading data for DeFi protocols on Base.",
  "version": "1.2.0",
  "image": "https://cdn.solarpunk.buzz/agents/trading-avatar.png",
  "services": [
    { "name": "x402", "endpoint": "https://data.solarpunk.buzz/trading/v1" },
    { "name": "a2a",  "endpoint": "https://a2a.solarpunk.buzz/trading" }
  ],
  "x402Support": true,
  "active": true,
  "capabilities": ["trading", "historical-data", "price-feeds"]
}

[2/3] Uploading to Swarm…
  Reference: 3a4b5c6d7e8f...
  AgentURI:  https://api.gateway.ethswarm.org/feeds/f39fd6e51aad88f6f4ce6ab8827279cfffb92266/6167656e742d63617264...

[3/3] Registering on-chain…

✓ Agent registered successfully
{
  "agentId": "42",
  "txHash": "0xabc123def456...",
  "agentURI": "https://api.gateway.ethswarm.org/feeds/f39fd6e51aad88f6f4ce6ab8827279cfffb92266/6167656e742d63617264..."
}
```

- **`agentId`** — the NFT token ID assigned by the Identity Registry. Use this for reputation queries and metadata lookups.
- **`txHash`** — the Base Sepolia transaction hash. Verify at `https://sepolia.basescan.org/tx/<txHash>`.
- **`agentURI`** — the Swarm feed URL stored on-chain. It always resolves to the latest version of the Agent Card, so the URI never needs to change even if the card is updated.

### Running from the monorepo root

You can run the command from anywhere in the repo using pnpm's `--filter` flag — no need to `cd` into the package first:

```sh
pnpm --filter @solarpunk/erc8004-adapter create-agent \
  --name "Solarpunk Trading Data Agent" \
  --description "Provides real-time and historical trading data for DeFi protocols on Base." \
  --image "https://cdn.solarpunk.buzz/agents/trading-avatar.png" \
  --version "1.2.0" \
  --x402 "https://data.solarpunk.buzz/trading/v1" \
  --a2a "https://a2a.solarpunk.buzz/trading" \
  --capabilities "trading,historical-data,price-feeds" \
  --privateKey "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
  --feedPrivateKey "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
```

### Using env vars instead of flags

If `PRIVATE_KEY` and `BEE_FEED_PK` are already in your environment or `.env`, you can omit the key flags:

```sh
pnpm --filter @solarpunk/erc8004-adapter create-agent \
  --name "Solarpunk Trading Data Agent" \
  --description "Provides real-time and historical trading data for DeFi protocols on Base." \
  --x402 "https://data.solarpunk.buzz/trading/v1" \
  --capabilities "trading,price-feeds"
```

---

## CLI — `discover-agents`

The `discover-agents` script queries the Identity Registry for every agent that has the `swarm_ai_capable` metadata flag set to `1`, then fetches each matching agent's card from Swarm and prints the full list as JSON. No Swarm upload or on-chain write is performed — the command is read-only.

```sh
pnpm discover-agents [--privateKey "0x..."]
```

### Flags

| Flag           | Required | Description                                                                                                                                            |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--privateKey` | No       | On-chain wallet private key — falls back to `PRIVATE_KEY` env var. Required in practice (used to initialize the provider/signer for contract queries). |

When `PRIVATE_KEY` is already set in your `.env`, no flags are needed at all.

### What it does

1. Scans all `MetadataSet` events on the Identity Registry for the key `swarm_ai_capable`, deduplicating to the latest value per agent.
2. Filters to agents whose value equals `1` (capability active).
3. For each matching agent, fetches the Agent Card JSON from the Swarm feed URL stored on-chain.
4. Prints a JSON array with one entry per agent: `agentId`, `agentURI`, and the full `agentCard` object.

If a Swarm fetch fails for a specific agent (e.g. the card is temporarily unreachable), a warning is printed to stderr and `agentCard` is `null` for that entry — the rest of the results are still returned.

### Example

```sh
pnpm discover-agents --privateKey "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

Or, with `PRIVATE_KEY` already in `.env`:

```sh
pnpm discover-agents
```

### Output

```
Discovering swarm_ai_capable agents…
Found 2 capable agent(s). Fetching agent cards…

[
  {
    "agentId": "41",
    "agentURI": "https://api.gateway.ethswarm.org/feeds/f39fd6e51aad88f6f4ce6ab8827279cfffb92266/6167656e742d63617264...",
    "agentCard": {
      "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      "name": "Solarpunk Weather Data Agent",
      "version": "1.0.0",
      "description": "Provides historical and real-time weather data for on-chain applications.",
      "image": "https://api.gateway.ethswarm.org/bzz/1edce577.../img/avatar.jpg",
      "services": [
        { "name": "x402", "endpoint": "https://data.solarpunk.buzz/weather/v1" },
        { "name": "a2a",  "endpoint": "https://a2a.solarpunk.buzz/weather" }
      ],
      "x402Support": true,
      "active": true,
      "capabilities": ["weather", "historical-data"]
    }
  },
  {
    "agentId": "42",
    "agentURI": "https://api.gateway.ethswarm.org/feeds/f39fd6e51aad88f6f4ce6ab8827279cfffb92266/6167656e742d63617264...",
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
]
```

- **`agentId`** — the NFT token ID in the Identity Registry.
- **`agentURI`** — the Swarm feed URL stored on-chain; always resolves to the latest version of the Agent Card.
- **`agentCard`** — the parsed Agent Card fetched from Swarm, or `null` if the fetch failed.

### Running from the monorepo root

```sh
pnpm --filter @solarpunk/erc8004-adapter discover-agents \
  --privateKey "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

### Using env vars instead of flags

With `PRIVATE_KEY` in your `.env`:

```sh
pnpm --filter @solarpunk/erc8004-adapter discover-agents
```

---

## API Reference

> For an overview of how these modules layer on top of the on-chain contracts, see the [Architecture diagram](#architecture) above.

**Type conventions:** All agent IDs are `bigint` (matching Solidity `uint256`). All normalized scores are `number` in the 0–100 range.

### `createERC8004Client(config)`

Factory function. Returns `{ identity, reputation, aggregate }`.

```typescript
interface ERC8004Config {
  provider: Provider;
  signer?: Signer; // required for write operations
  chain: 'base-sepolia' | 'base' | 'mainnet' | string;
  contracts?: {
    identityRegistry?: string; // override deployed address
    reputationRegistry?: string;
  };
}
```

Only `base-sepolia` has pre-configured contract addresses. For other chains, pass addresses via `config.contracts`.

---

### IdentityModule (`erc8004.identity`)

| Method                   | Signature                                                                        | Description                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`               | `(agentURI: string, metadata?: MetadataEntry[]) → RegisterResult`                | Mints a new agent NFT with optional on-chain metadata. Returns `{ agentId, txHash }`.                                                                                                                                                   |
| `getAgentURI`            | `(agentId: bigint) → string`                                                     | Reads the stored `bzz://` URI from the NFT.                                                                                                                                                                                             |
| `setAgentURI`            | `(agentId, newURI) → txHash`                                                     | Updates the URI. Owner/operator only.                                                                                                                                                                                                   |
| `getOwner`               | `(agentId: bigint) → address`                                                    | Returns current NFT owner.                                                                                                                                                                                                              |
| `setAgentWallet`         | `(agentId, wallet, deadline, sig) → txHash`                                      | Attaches a hot wallet for payments, keeping the agent NFT owner separate. Requires EIP-712 proof.                                                                                                                                       |
| `getAgentWallet`         | `(agentId: bigint) → address`                                                    | Returns the associated wallet, or zero address.                                                                                                                                                                                         |
| `setMetadata`            | `(agentId, key, value: Uint8Array) → txHash`                                     | Stores arbitrary key/value bytes on-chain.                                                                                                                                                                                              |
| `getMetadata`            | `(agentId, key) → Uint8Array`                                                    | Reads stored metadata bytes.                                                                                                                                                                                                            |
| `getRegisteredAgents`    | `(fromBlock?, toBlock?) → { agentId, agentURI, owner }[]`                        | Returns all agents registered in the given block range by scanning `Registered` events.                                                                                                                                                 |
| `getAgentsByMetadata`    | `(metadataKey, fromBlock?, toBlock?) → { agentId, rawValue: Uint8Array }[]`      | Returns all agents that had a given metadata key set, by scanning `MetadataSet` events. May include duplicates if a key was overwritten — filter to the latest entry per `agentId` or confirm with `getMetadata` for the current value. |
| `findAgentsWithMetadata` | `(metadataKey, fromBlock?, toBlock?) → { agentId, uri, rawValue: Uint8Array }[]` | Higher-level helper: scans `MetadataSet` events, deduplicates by `agentId` (latest event wins), and fetches the on-chain URI for each matching agent. Use `ethers.toBigInt(rawValue) === 1n` to filter for boolean-flag metadata keys.  |

---

### ReputationModule (`erc8004.reputation`)

| Method               | Signature                                                       | Description                                                                          |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `postFeedback`       | `(params: PostFeedbackParams) → txHash`                         | Submits a feedback score to the Reputation Registry.                                 |
| `revokeFeedback`     | `(agentId, feedbackIndex) → txHash`                             | Revokes a previously submitted feedback entry.                                       |
| `getFeedback`        | `(agentId, clientAddress, feedbackIndex) → FeedbackResult`      | Reads a single feedback entry.                                                       |
| `getSummary`         | `(agentId, clientAddresses?, tag1?, tag2?) → ReputationSummary` | Aggregates feedback on-chain. Auto-fetches client list if not provided.              |
| `signFeedbackAuth`   | `(agentId, consumerAddress, ttlSeconds?) → FeedbackAuth`        | Provider signs an EIP-712 token authorizing a consumer to post feedback.             |
| `verifyFeedbackAuth` | `(auth, expectedConsumer?) → recoveredSigner`                   | Verifies a `FeedbackAuth` token off-chain. Throws if expired or consumer mismatched. |

**`PostFeedbackParams`:**

```typescript
interface PostFeedbackParams {
  agentId: bigint;
  score: number; // 0–100 (clamped automatically)
  tags?: [string?, string?]; // up to 2 classification tags
  evidenceURI?: string; // bzz:// or https:// — anchors fine-grained review data off-chain; its keccak256 hash is stored on-chain for integrity
  feedbackAuth?: FeedbackAuth; // EIP-712 token from provider (recommended)
  endpoint?: string; // which provider endpoint was used
}
```

**`FeedbackAuth`:**

```typescript
interface FeedbackAuth {
  agentId: bigint;
  consumer: string; // consumer wallet address
  deadline: number; // unix timestamp — token expires after this
  signature: string; // EIP-712 signature from the provider wallet
}
```

---

### AggregateModule (`erc8004.aggregate`)

| Method                | Signature                             | Description                                           |
| --------------------- | ------------------------------------- | ----------------------------------------------------- |
| `calculateReputation` | `(agentId: bigint) → ReputationScore` | Fetches all feedback and returns an aggregated score. |

**`ReputationScore`:**

```typescript
interface ReputationScore {
  agentId: bigint;
  score: number; // 0–100 average across all feedback
  feedbackCount: bigint;
  reliable: boolean; // true when score >= 70 AND feedbackCount >= 3
}
```

---

### Agent Card helpers

```typescript
import {
  generateAgentCard,
  generateRegistrationFile, // alias for generateAgentCard
  serializeAgentCard,
  parseAgentCard,
} from '@solarpunk/erc8004-adapter';
```

| Function                        | Description                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateAgentCard(params)`     | Creates an `AgentCard` object. `name`, `description`, `version`, and `services` are required. `type`, `active`, `x402Support`, and `registrations` default when omitted. `capabilities` and `supportedTrust` are optional string arrays.                   |
| `serializeAgentCard(card)`      | JSON-stringifies with 2-space indentation. Use this as the content to upload to Swarm.                                                                                                                                                                     |
| `parseAgentCard(json)`          | Parses and validates a JSON string. Throws if `type` is not the ERC-8004 registration type string, or if `name`, `description`, `services`, `x402Support`, or `active` are missing or invalid. `registrations` is optional and may be absent or undefined. |
| `uploadAgentCard(card, topic?)` | Uploads the card to a Swarm feed and returns `{ reference, url, feedUrl }`. Reads `BEE_FEED_PK`, `BEE_API_URL`, and `BEE_POSTAGE_STAMP` from the environment. `feedUrl` always uses the public Swarm gateway.                                              |

`uploadAgentCard` returns a `SwarmUploadResult`:

```typescript
interface SwarmUploadResult {
  reference: string; // 64-char hex Swarm content hash
  url: string; // bzz://<reference> — immutable direct link to this version
  feedUrl: string; // https://api.gateway.ethswarm.org/feeds/<owner>/<topic> — always resolves to the latest version
}
```

Example:

```typescript
import { generateAgentCard, uploadAgentCard } from '@solarpunk/erc8004-adapter';

const card = generateAgentCard({ ... });
// BEE_FEED_PK, BEE_API_URL, BEE_POSTAGE_STAMP are read from environment
const { feedUrl } = await uploadAgentCard(card);

// Use the feed URL as the on-chain agent URI so the card can be updated later
const { agentId } = await erc8004.identity.register(feedUrl);
```

**`AgentCard` structure:**

```typescript
interface AgentCard {
  type: string; // MUST be "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  name: string;
  description: string;
  version: string; // e.g. "1.0.0" — semver or date string identifying the card revision
  image?: string; // OPTIONAL — defaults to a Swarm-hosted placeholder avatar
  services: AgentService[];
  x402Support: boolean; // true if the agent accepts x402 micropayments
  active: boolean; // false to soft-deactivate without un-registering
  registrations?: AgentRegistration[]; // OPTIONAL — populated after on-chain registration
  supportedTrust?: string[]; // e.g. ["reputation", "crypto-economic"]
  capabilities?: string[]; // OPTIONAL — e.g. ["Swarm", "trading", "image_generation"]
}

interface AgentService {
  name: string; // e.g. "MCP", "A2A", "x402", "web"
  endpoint: string; // full URL or bzz:// URI
  version?: string; // e.g. "0.3.0" or "2025-06-18"
  skills?: string[];
  domains?: string[];
}

interface AgentRegistration {
  agentId: bigint;
  agentRegistry: string; // CAIP-10 reference, e.g. "eip155:84532:0x8004A818..."
}
```

---

## Deployed Contracts

| Chain            | Network | Identity Registry                            | Reputation Registry                          |
| ---------------- | ------- | -------------------------------------------- | -------------------------------------------- |
| Base Sepolia     | Testnet | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Base Mainnet     | —       | not configured                               | not configured                               |
| Ethereum Mainnet | —       | not configured                               | not configured                               |

Agents registered on Base Sepolia are browsable at [8004scan.io](https://8004scan.io).

---

## Running the Integration Test

The integration test registers a real agent on Base Sepolia, signs a `FeedbackAuth`, posts feedback, and reads back the aggregated reputation. It sends two on-chain transactions and requires testnet ETH.

### 1. Set up environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PRIVATE_KEY=0x<provider-private-key>
CONSUMER_PRIVATE_KEY=0x<consumer-private-key>   # must be a different funded wallet
RPC_URL=https://sepolia.base.org                 # optional, this is the default
CHAIN=base-sepolia                               # optional, this is the default
BEE_FEED_PK=0x<hex-private-key>                 # required to upload Agent Card to Swarm
BEE_API_URL=http://localhost:1633                # optional, this is the default (Bee node used for uploading)
BEE_POSTAGE_STAMP=<64-char-hex-stamp-id>         # optional, auto-discovered from Bee node if not set
```

Get testnet ETH from the [Base Sepolia faucet](https://faucet.quicknode.com/base/sepolia) for both wallets.

> **Why two wallets?** The ERC-8004 contract rejects feedback submitted by the agent owner — self-feedback is not allowed at the contract level. `CONSUMER_PRIVATE_KEY` is optional: if omitted, steps 1–4 still run and the FeedbackAuth signing is verified off-chain, but the on-chain feedback transaction (step 5) is skipped.

> **Swarm upload:** `BEE_FEED_PK` is required to upload the Agent Card to Swarm. If not set, step 2 is skipped and a placeholder `bzz://` URI is registered on-chain instead. `BEE_POSTAGE_STAMP` is optional — if omitted, the Bee node is queried automatically for a usable batch. To buy a stamp, run `bee stamp buy --depth 20 --amount 100` on your Bee node.

### 2. Build the package

```bash
pnpm install
pnpm build
```

### 3. Run the test

```bash
pnpm test:sepolia
```

Expected output:

```
[Provider wallet] 0xProviderAddress
[Balance] 0.05 ETH

  Note: CONSUMER_PRIVATE_KEY not set. Using an ephemeral wallet for step 3.
  Step 4 (post feedback on-chain) will be skipped.
  Set CONSUMER_PRIVATE_KEY to a different funded wallet to run the full flow.

[Consumer wallet] 0xEphemeralAddress

[Step 1: Generate Agent Card]
[Agent Card] { name: 'Test Data Provider', ... }
[Agent Card round-trip] OK

[Step 2: Upload Agent Card to Swarm]
  Skipped — BEE_FEED_PK not set. Using placeholder URI.
  Set BEE_FEED_PK (and optionally BEE_POSTAGE_STAMP, BEE_API_URL) to upload.

[Step 3: Register on-chain (Identity Registry)]
  Sending transaction...
[Registered agentId] 42
[Transaction] 0x...
[On-chain URI] bzz://placeholder-...
[On-chain owner] 0xProviderAddress

[Step 4: Sign FeedbackAuth (provider → consumer)]
[FeedbackAuth] { agentId: '42', consumer: '0x...', deadline: 1234567890, signature: '0x...' }
[Recovered signer] 0xProviderAddress
[FeedbackAuth verify] OK

[Step 5: Post feedback (Reputation Registry)]
  Skipped — set CONSUMER_PRIVATE_KEY to a different funded wallet to run this step.
  The contract does not allow the agent owner to submit feedback on their own agent.

✓ Steps completed successfully
  agentId: 42
  View on BaseScan: https://sepolia.basescan.org/tx/0x...
```

With both `BEE_FEED_PK` and `CONSUMER_PRIVATE_KEY` set, the full flow runs:

```
[Step 2: Upload Agent Card to Swarm]
  Uploading to Swarm feed...
[Swarm reference] a1b2c3d4...
[Feed URL] https://api.gateway.ethswarm.org/feeds/0xowneraddress/topichex...

[Step 3: Register on-chain (Identity Registry)]
  Sending transaction...
[Registered agentId] 42
...

[Step 5: Post feedback (Reputation Registry)]
  Sending transaction...
[Feedback tx] 0x...

[Step 6: Calculate reputation]
[Reputation] { agentId: '42', score: 90, feedbackCount: '1', reliable: false }

✓ Steps completed successfully
  agentId: 42
  View on BaseScan: https://sepolia.basescan.org/tx/0x...
```

> The `reliable` flag requires `score >= 70` and at least **3** feedback entries. A single test submission will always show `reliable: false`.

> The integration test typically completes in under 30 seconds on Base Sepolia, depending on network congestion. If it pauses silently after "Sending transaction...", the node is waiting for block confirmation — this is normal.

### 4. Run unit tests

```bash
pnpm test
```

Unit tests use Jest. No wallet or network connection is needed.

---

## Custom Chain / Local Node

To use a custom RPC or a locally deployed contract:

```typescript
const erc8004 = createERC8004Client({
  provider,
  signer,
  chain: 'base-sepolia', // used for EIP-712 domain chainId
  contracts: {
    identityRegistry: '0xCustomIdentityAddress',
    reputationRegistry: '0xCustomReputationAddress',
  },
});
```

For fully custom chains not in the pre-configured list, pass any string as `chain` along with explicit `contracts` addresses:

```typescript
const erc8004 = createERC8004Client({
  provider,
  signer,
  chain: 'hardhat',
  contracts: {
    identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    reputationRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  },
});
```

---

## Development

```bash
pnpm install          # install dependencies
pnpm build            # compile TypeScript → dist/
pnpm dev              # watch mode
pnpm test             # run unit tests
pnpm test:sepolia     # end-to-end integration test on Base Sepolia
```

---

## Security

All sensitive operations are off-chain. The SDK signs `FeedbackAuth` tokens using EIP-712 typed data and forwards the resulting signature to the Reputation Registry — private keys are never transmitted or stored. Read-only operations (checking reputation, reading agent URIs) require only a `Provider` and expose no key material.

---

## Contributing

Contributions and bug reports are welcome. Please open an issue or PR with a failing test case that reproduces the problem.
