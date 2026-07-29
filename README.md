# Swarm Data Exchange

A decentralized marketplace where AI agents publish, discover, and purchase AI data assets stored on the [Ethswarm](https://www.ethswarm.org/) network, gated by [x402](https://x402.org/) micropayments and ACT (Access Control Trie) encryption.

The project combines four building blocks:

- **Ethswarm** for permissionless, content-addressed storage of data assets, samples, and catalog metadata.
- **ACT (Access Control Trie)** for per-purchase content encryption — priced items are never distributed in the clear.
- **ERC-8004** for on-chain agent identity, discovery, and reputation.
- **x402** for HTTP-native micropayments over EVM stablecoins, verified by a facilitator and settled per purchase.

The full protocol is specified in [`documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md`](documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md). Read it before changing publisher, server, or reader behaviour — the spec supersedes any prior implementation notes.

## How it fits together

```
                     ┌──────────────────────┐
                     │  ERC-8004 Registry   │  agent id → Agent Card (Swarm URI)
                     │   (base-sepolia)     │  Agent Card carries a
                     └──────────┬───────────┘  "swarm-ai-catalog" service
                                │                 pointing at the catalog feed owner
                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                          Ethswarm                              │
   │  ┌───────────────┐   ┌────────────────┐   ┌─────────────────┐  │
   │  │ Catalog feed  │──▶│ Catalog        │──▶│ Per-item        │  │
   │  │ (cold key)    │   │ Mantaray root  │   │ item.jsonld +   │  │
   │  │               │   │ /catalog.jsonld│   │ sample bytes    │  │
   │  └───────────────┘   └────────────────┘   └─────────────────┘  │
   │                                                                │
   │  ┌──────────────────┐        ┌──────────────────────────────┐  │
   │  │ Per-item state   │◀──────▶│ ACT-wrapped priced content   │  │
   │  │ feed (hot key)   │        │ (itemId = content reference) │  │
   │  └──────────────────┘        └──────────────────────────────┘  │
   └────────────────────────────────────────────────────────────────┘
                    ▲                                    ▲
                    │                                    │ ACT grant
                    │ reads                              │
   ┌────────────────┴───────────────┐   ┌────────────────┴─────────┐
   │  Consumer (catalogue-feed-     │   │  Publisher server        │
   │  browser)                      │──▶│  (x402-swarm-server)     │
   │  - lists items via Mantaray    │   │  - POST /v1/items/:id/   │
   │  - signs PurchaseIntent + x402 │   │      purchase            │
   │  - fetches ACT-wrapped content │   │  - verifies EIP-712 +    │
   └────────────────────────────────┘   │      x402, settles,      │
                                        │      grants ACT access   │
                                        └──────────────────────────┘
```

**Publish path.** A publisher agent uploads priced content ACT-encrypted, captures the initial `actHistoryRef` + `granteeRef`, then uses `@solarpunk/swarm-catalog` (directly or via the `swarm-market-mcp` server) to stage `CatalogItem`s, build the catalog Mantaray, push the catalog feed, and initialize per-item state feeds.

**Discover path.** A consumer resolves an ERC-8004 agent id → Agent Card → catalog feed owner → catalog Mantaray root, then traverses `/items/{itemId}/item.jsonld` leaves for browsing and sample previews.

**Purchase path.** The consumer signs a `PurchaseIntent` (EIP-712) plus an ERC-3009 payment authorization, hits the publisher's `POST /v1/items/:itemId/purchase`, and — after a 12-step server verification and x402 facilitator settlement — receives an ACT grant that unlocks the content. The state feed advances per grant; consumers use it only to verify grants they already hold.

## Packages

All packages live under `packages/` and are managed with pnpm workspaces.

| Package                                                                | Description                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@solarpunk/swarm-catalog`](packages/swarm-catalog)                   | Publisher SDK. TypeScript types (spec Appendix A), `SwarmCatalogBuilder` (stage → dryRun → publish), catalog feed management, per-item state feed management, JSON-LD serialization. Downstream packages depend on this.                                                                                              |
| [`@solarpunk/x402-swarm-server`](packages/x402-swarm-server)           | Publisher HTTP server. Exposes `POST /v1/items/:itemId/purchase` (three-phase x402 flow), performs 12-step `PurchaseIntent` verification (EIP-712), keeps a nonce store + purchase records in SQLite, writes to the per-item state feed after each successful ACT grant, and returns structured `ApiError` responses. |
| [`@solarpunk/catalogue-feed-browser`](packages/catalogue-feed-browser) | Consumer UI/server. Reads the catalog feed → Mantaray root, renders list + detail views, previews samples, signs `PurchaseIntent` + ERC-3009 authorization, and drives the purchase flow against `x402-swarm-server`.                                                                                                 |
| [`@solarpunk/erc8004-adapter`](packages/erc8004-adapter)               | ERC-8004 identity + reputation adapter (SDK + CLI). Handles Agent Card lifecycle, on-chain registration on Base Sepolia, and the `"swarm-ai-catalog"` services entry that ties an agent to its catalog feed owner.                                                                                                    |
| [`@solarpunk/erc8004-dashboard`](packages/erc8004-dashboard)           | React UI for browsing ERC-8004 agents. "Browse Catalog" jumps into `catalogue-feed-browser` using the owner address from the Agent Card's `"swarm-ai-catalog"` service.                                                                                                                                               |
| [`swarm-market-mcp`](packages/swarm-market-mcp)                        | Model Context Protocol (MCP) server exposing marketplace operations to LLM agents. `build_catalog` orchestrates `SwarmCatalogBuilder` for one-shot publishing; `get_agent` resolves an ERC-8004 id to its Agent Card and, optionally, enumerates the agent's catalog.                                                 |

## Tech stack

- **TypeScript** throughout
- **[`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js)** for all Swarm interactions (Mantaray, feeds, ACT)
- **[`ethers` v6](https://docs.ethers.org/v6/)** in `erc8004-adapter`; **[`viem`](https://viem.sh/)** in `x402-swarm-server` and `catalogue-feed-browser`
- **[`@x402/express`](https://x402.org/), `@x402/evm`, `@x402/core`, `@x402/fetch`** for payment middleware
- **Express** for HTTP servers
- **`better-sqlite3`** for local persistent stores (nonce store, purchase records)
- **React** for `erc8004-dashboard` and `catalogue-feed-browser` UIs

## Getting started

**Requirements**

- Node.js **≥ 22**
- pnpm **≥ 9**
- A local Bee node reachable at `http://localhost:1633` (light node is sufficient for most tasks; the [Swarm Desktop](https://www.ethswarm.org/build/desktop) app is the easiest way to run one on Windows/macOS)
- Funded xDAI + xBZZ on the Bee node for postage stamps and cheques
- A stable Gnosis Chain RPC endpoint (Bee's default `blockchain-rpc-endpoint` — public load-balanced RPCs can cause chain-state oscillation; prefer a personal Gateway.fm / BlockPi / Ankr key)

**Install**

```bash
pnpm install
```

**Configure**

Copy `.env.example` → `.env` in each package that provides one (currently `erc8004-adapter`, `x402-swarm-server`, `catalogue-feed-browser`, `swarm-market-mcp`) and fill in the values documented in each package's README / CLAUDE.md.

**Run**

```bash
# Everything in parallel (respects each package's dev script)
pnpm dev

# A single package in dev mode
pnpm --filter @solarpunk/x402-swarm-server dev

# Ad-hoc during prototyping (no build step)
cd packages/<name> && npx tsx src/index.ts
```

**Build / test / lint**

```bash
pnpm build       # tsc -b across all packages
pnpm test        # per-package test scripts
pnpm typecheck   # tsc --noEmit across all packages
pnpm lint        # eslint .
pnpm format      # prettier --write .
```

## Key environment variables

Consolidated view across packages — see each package's docs for the authoritative list.

| Variable                          | Package(s)                                                                  | Purpose                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BEE_API_URL`                     | all                                                                         | Bee node endpoint, default `http://localhost:1633`                                                         |
| `BEE_FEED_PK`                     | `swarm-catalog`, `x402-swarm-server`, `erc8004-adapter`, `swarm-market-mcp` | Catalog feed signer private key (cold key)                                                                 |
| `ITEM_STATE_FEED_PK`              | `x402-swarm-server`, `swarm-market-mcp`                                     | Per-item state feed signer private key (hot key) — MUST differ from `BEE_FEED_PK`                          |
| `POSTAGE_BATCH_ID`                | `swarm-catalog`, `x402-swarm-server`, `swarm-market-mcp`                    | Postage stamp batch ID for uploads (note: `erc8004-adapter` uses `BEE_POSTAGE_STAMP` for the same concept) |
| `CATALOG_FEED_OWNER`              | `x402-swarm-server`                                                         | EOA address of the catalog feed signer — used to locate the catalog on Swarm                               |
| `PURCHASE_INTENT_DOMAIN_CONTRACT` | `x402-swarm-server`                                                         | `verifyingContract` address for the EIP-712 `PurchaseIntent` domain                                        |
| `FACILITATOR_URL`                 | `x402-swarm-server`                                                         | x402 facilitator endpoint, default `https://x402.org/facilitator`                                          |
| `EVM_PRIVATE_KEY`                 | `catalogue-feed-browser`                                                    | Consumer wallet key for signing `PurchaseIntent` and ERC-3009 authorization                                |
| `PRIVATE_KEY`                     | `erc8004-adapter`                                                           | On-chain transaction signer for ERC-8004 registration                                                      |
| `RPC_URL`                         | `erc8004-adapter`, `swarm-market-mcp`                                       | EVM RPC endpoint (default `https://sepolia.base.org`)                                                      |
| `DB_PATH`                         | `x402-swarm-server`                                                         | SQLite path for nonce store + purchase records, default `./data/store.db`                                  |

## Load-bearing invariants

These constraints come from the spec and are enforced across packages. Do not violate them.

- **All priced content is ACT-protected.** No per-item flag — if it's priced, it's ACT-wrapped.
- **`itemId` equals the priced content's Swarm reference** (64-char hex). The content address is the identifier.
- **Catalog feed payload is a bare 64-char hex Mantaray root.** Not JSON, not an envelope.
- **Catalog feed topic is a fixed protocol constant:** `keccak256("swarm-ai-catalog.v1")`.
- **Per-item state feed topic:** `keccak256("swarm-ai-catalog-state.v1" || catalogFeedOwner || itemId)` — binds the state feed to its catalog and prevents reattachment.
- **ACT history reference lives in `CatalogItemState`,** written to the per-item state feed — never in `item.jsonld`.
- **Two separate feed signers:** cold catalog feed signer ≠ hot per-item state feed signer.
- **State feed is verification-only for consumers** — never a discovery, notification, or popularity channel.
- **Purchase record is written between steps 9 and 10** of the purchase flow — after `/settle`, before ACT grant — so the record survives even if the grant fails and needs retry.

## Prototype scope

**In scope**

- `swarm-catalog` types + `SwarmCatalogBuilder` (stage + dryRun + publish)
- `x402-swarm-server` refactor to the three-phase `POST /v1/items/:itemId/purchase` flow with 12-step `PurchaseIntent` verification
- `catalogue-feed-browser` catalog reader, sample preview, purchase flow
- `erc8004-adapter` `"swarm-ai-catalog"` services entry + `--catalog-feed-owner` CLI flag; fix for `registrations[]` not being written back to the Agent Card after on-chain registration

**Out of scope** (for the current prototype)

- Crash recovery / publisher intent persistence
- Cursor pagination
- Bazaar indexer integration
- ENS registration of `swarm-ai-catalog.eth`
- Optional pass-through endpoints `GET /v1/catalog` / `GET /v1/state/:itemId`
- Multi-publisher / federated catalogs
- Croissant 1.1 validator

## Repository layout

```
.
├── CLAUDE.md                  Guidance for Claude Code and human contributors
├── README.md                  You are here
├── documents/                 Specifications and design notes (v1 spec lives here)
├── package.json               Root workspace scripts + dev dependencies
├── pnpm-workspace.yaml        Workspace definition
├── tsconfig.base.json         Shared TS compiler options
├── eslint.config.mjs          Flat ESLint config for all packages
└── packages/                  Individual publishable/deployable packages
```

## License

TBD.
