# @solarpunk/catalogue-job

A long-running service that runs every 5 minutes, discovers ERC-8004 agents, fetches the JSON catalogue from each agent's Swarm service endpoint, and publishes the aggregated result to a Swarm feed.

## How it works

1. Spawns `pnpm discover-agents` inside `packages/erc8004-adapter` to get all on-chain agents with `swarm_ai_capable=1`.
2. For each agent, reads `agentCard.services` and finds the entry with `name: "Swarm"`.
3. Fetches the JSON at that service's `endpoint` URL — this is the agent's catalogue.
4. Uploads the aggregated array to a Swarm single-owner feed signed with `BEE_FEED_PK` under the topic derived from `CATALOGUE`.

The feed payload is a JSON array:

```json
[
  {
    "agentId": "42",
    "catalogue": {}
  }
]
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable            | Required  | Description                                                                                    |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `CATALOGUE`         | **yes**   | Feed topic for the published catalogue. Plain text (e.g. `catalogue`) or a 64-char hex string. |
| `BEE_FEED_PK`       | **yes**   | Hex private key used to sign catalogue feed updates.                                           |
| `BEE_POSTAGE_STAMP` | **yes**   | 64-char hex postage batch ID for Swarm uploads.                                                |
| `BEE_API_URL`       | no        | Bee node HTTP API base URL. Defaults to `http://localhost:1633`.                               |
| `PRIVATE_KEY`       | **yes\*** | Wallet private key — passed through to `discover-agents` for on-chain queries.                 |
| `RPC_URL`           | no        | JSON-RPC endpoint. Defaults to `https://sepolia.base.org`.                                     |
| `CHAIN`             | no        | Chain identifier (`base-sepolia`, `base`, `mainnet`). Defaults to `base-sepolia`.              |

\* Required by the `discover-agents` subprocess. Set it here and it will be inherited automatically.

## Running

### Development (TypeScript, no build step)

```bash
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

### From the monorepo root

```bash
pnpm --filter @solarpunk/catalogue-job dev
pnpm --filter @solarpunk/catalogue-job start
```

## Reading the feed

The catalogue feed is a Swarm single-owner feed. To read it you need the owner address (derived from `BEE_FEED_PK`) and the topic hash of `CATALOGUE`:

```
GET {BEE_API_URL}/feeds/{owner}/{topic}
```

The response body is the JSON array described above.
