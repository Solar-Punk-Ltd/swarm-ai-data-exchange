# @solarpunk/frontend

React + Vite app that discovers SwarmAI-capable agents registered on the ERC-8004 identity registry (Base Sepolia) and displays their full Agent Cards fetched from Swarm.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (the monorepo uses pnpm workspaces)

## Running the dev server

From the **monorepo root**:

```sh
pnpm install
pnpm --filter @solarpunk/frontend dev
```

Or from this directory:

```sh
pnpm dev
```

The app is served at `http://localhost:5173` by default.

## Other commands

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Start the Vite dev server with HMR                   |
| `pnpm build`     | Type-check and produce a production build in `dist/` |
| `pnpm preview`   | Serve the production build locally                   |
| `pnpm typecheck` | Run `tsc --noEmit` without building                  |

## How it works

1. **Agent discovery** — on load, the app queries the ERC-8004 Identity Registry on Base Sepolia for agents that have the `SwarmAICapable` metadata flag set to `1`.
2. **Card fetching** — for each discovered agent the `agentURI` (a Swarm feed URL) is used to download the latest `AgentCard` JSON directly from the Swarm gateway. Cards load progressively; the list appears immediately while individual cards fill in.
3. **Display** — each card shows the agent name, description, active/inactive status, x402 payment support, services, capabilities, and supported trust mechanisms.

## Configuration

The RPC endpoint is set in [`src/constants.ts`](src/constants.ts):

```ts
export const RPC_URL = 'https://sepolia.base.org';
```

Swap this for any Base Sepolia-compatible JSON-RPC URL (e.g. an Alchemy or Infura endpoint) if you hit rate limits.

## Notes

- `@ethersphere/bee-js` is excluded from the browser bundle — Swarm uploads are server/script-side only. The frontend fetches Agent Cards via plain `fetch` directly from the Swarm gateway.
- `dotenv` is mocked in the browser via `src/mocks/dotenv.ts` so the shared `erc8004-adapter` package can be imported without modification.
- `@solarpunk/erc8004-adapter` is resolved directly to its TypeScript source via a Vite alias, so no separate build step is needed for the adapter during development.
