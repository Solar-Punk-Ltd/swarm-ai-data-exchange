# Swarm AI Data Exchange

Decentralized marketplace where AI agents publish, discover, and purchase AI data assets stored on the Ethswarm network, gated by x402 micropayments and ACT (Access Control Trie) encryption.

## Specification

The catalog architecture is fully specified in:
`documents/swarm-ai-catalog-design-v1_2026-05-26-final.md`

**Read this document before implementing anything in `swarm-catalog`, `x402-swarm-server`, or `catalogue-feed-browser`.** Key sections:

- Part 3 — Architecture Overview (three-layer model)
- Part 4 — Feeds (catalog feed + per-item state feeds)
- Part 5 — Catalog Mantaray schema
- Part 6 — Data model (CatalogItem, CatalogItemState, ActGrantResult)
- Part 10 — HTTP API (purchase endpoint three-phase flow)
- Part 11 — PurchaseIntent EIP-712 envelope and 12-step server verification
- Part 12 — Publisher flow (SwarmCatalogBuilder steps)
- Part 13 — Reader flow (Mantaray traversal)
- Appendix A — TypeScript reference types (implement these exactly)

## Tech Stack

- TypeScript throughout
- `@ethersphere/bee-js` for all Swarm interactions (Mantaray, feeds, ACT)
- `ethers` v6 in `erc8004-adapter`; `viem` in `x402-swarm-server` and `catalogue-feed-browser`
- `@x402/express`, `@x402/evm`, `@x402/core`, `@x402/fetch` for payment middleware (`@x402/express` is server-side only; `@x402/fetch` is consumer-side only; `@x402/evm` and `@x402/core` are used in both)
- Express for HTTP servers
- `better-sqlite3` for local persistent stores (nonce store, purchase records)

## Package Structure

| Package                              | Status          | Purpose                                                                                                                                                                                                                        |
| ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/erc8004-adapter`           | Mostly complete | ERC-8004 identity, reputation, Agent Card lifecycle — SDK + CLI. Gap: `registrations[]` not written back after on-chain registration.                                                                                          |
| `packages/erc8004-dashboard`         | Mostly complete | React UI for agent discovery. Gap: "Browse Catalog" button reads owner from wrong services entry — needs to read the owner address from the `"swarm-ai-catalog"` service's `endpoint` field instead of the parsed `swarm` URL. |
| `packages/swarm-mcp`                 | Complete        | MCP server exposing Swarm operations to LLM agents                                                                                                                                                                             |
| `packages/swarm-catalog`             | **New**         | Publisher SDK: types, SwarmCatalogBuilder, catalog/state feed management                                                                                                                                                       |
| `packages/x402-swarm-server`         | Refactor        | Publisher HTTP server: x402 purchase endpoint, ACT grant, state feed write                                                                                                                                                     |
| `packages/catalogue-feed-browser`    | Refactor        | Consumer UI/server: catalog reader, sample preview, purchase flow                                                                                                                                                              |
| `packages/catalogue-job`             | Existing        | Background catalog indexing job                                                                                                                                                                                                |
| `packages/gsoc-data-event-processor` | Existing        | GSoC data event processing                                                                                                                                                                                                     |

## Prototype Scope

### In scope

- `packages/swarm-catalog`: all TypeScript types (Appendix A), `SwarmCatalogBuilder` (stage + publish), catalog feed management, per-item state feed management, JSON-LD serialization
- `packages/x402-swarm-server`: refactor to `POST /v1/items/:itemId/purchase` (three-phase), PurchaseIntent EIP-712 verification (12 steps), nonce store, state feed write post-grant, Mantaray catalog lookup, purchase record store, structured `ApiError` responses
- `packages/catalogue-feed-browser`: catalog feed → Mantaray traversal, list/detail view, sample preview, PurchaseIntent signing + purchase flow
- `packages/erc8004-adapter`: add `"swarm-ai-catalog"` services entry + `--catalog-feed-owner` CLI flag; fix `registrations[]` not being written back to Agent Card after on-chain registration

### Out of scope for prototype

- `SwarmCatalogBuilder.dryRun()` (§12.4)
- Crash recovery / publisher intent persistence (§12.5)
- Cursor pagination (§13.4)
- Bazaar indexer integration (§13.5)
- ENS registration of `swarm-ai-catalog.eth` (§18 open item)
- `GET /v1/catalog` and `GET /v1/state/:itemId` optional pass-through endpoints (§10.4, §10.5)
- MCP catalog integration in `swarm-mcp` (§16.1)
- Multi-publisher / federated catalogs (§18)
- Croissant 1.1 validator (§18 open item)

## Implementation Order

Each layer depends on the previous:

1. `packages/swarm-catalog` — types + builder (no downstream dependencies)
2. `packages/x402-swarm-server` — imports types from `swarm-catalog`
3. `packages/catalogue-feed-browser` — imports types from `swarm-catalog`, calls `x402-swarm-server`
4. `packages/erc8004-adapter` — independent minor addition

## Key Architectural Invariants

Never violate these — they are load-bearing constraints from the spec:

- **All priced content is ACT-protected.** No per-item flag. If it's priced, it's ACT-wrapped.
- **Catalog feed payload is a bare 64-char hex string.** Not JSON, not an envelope — just the Mantaray root reference.
- **Catalog feed topic is a fixed protocol constant:** `keccak256("swarm-ai-catalog.v1")` — no chain, registry, or agent identity encoded.
- **Per-item state feed topic:** `keccak256("swarm-ai-catalog-state.v1" || catalogFeedOwner || itemId)` — binds the state feed to its catalog, prevents reattachment.
- **itemId = priced content Swarm reference (64-char hex).** The content address is the item identifier.
- **ACT history reference lives in `CatalogItemState`, not in `item.jsonld`.** It advances per grant; it must not be in the catalog.
- **State feed is verification-only for consumers.** Never a discovery, notification, or popularity channel.
- **Two separate feed signers:** catalog feed signer (low-frequency, cold key) ≠ per-item state feed signer (high-frequency, hot key on purchase server).
- **Purchase record must be written between steps 9 and 10** of the purchase flow — after `/settle`, before ACT grant. Never loses the record even if grant fails.
