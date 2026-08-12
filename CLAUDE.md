# Swarm AI Data Exchange

Decentralized marketplace where AI agents publish, discover, and purchase AI data assets stored on the Ethswarm network, gated by x402 micropayments and ACT (Access Control Trie) encryption.

## Specification

The catalog architecture is fully specified in:
`documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md`

**Read this document before implementing anything in `swarm-catalog`, `x402-swarm-server`, or `catalogue-feed-browser`.** When implementing, read the relevant spec section first. Do not infer behaviour from package names or existing code — the v1 spec supersedes all prior implementations. Key sections:

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

| Package                           | Status          | Purpose                                                                                                                                                                                                                        |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/erc8004-adapter`        | Mostly complete | ERC-8004 identity, reputation, Agent Card lifecycle — SDK + CLI. Gap: `registrations[]` not written back after on-chain registration.                                                                                          |
| `packages/erc8004-dashboard`      | Mostly complete | React UI for agent discovery. Gap: "Browse Catalog" button reads owner from wrong services entry — needs to read the owner address from the `"swarm-ai-catalog"` service's `endpoint` field instead of the parsed `swarm` URL. |
| `packages/swarm-catalog`          | **New**         | Publisher SDK: types, SwarmCatalogBuilder, catalog/state feed management                                                                                                                                                       |
| `packages/x402-swarm-server`      | Refactor        | Publisher HTTP server: x402 purchase endpoint, ACT grant, state feed write                                                                                                                                                     |
| `packages/catalogue-feed-browser` | Refactor        | Consumer UI/server: catalog reader, sample preview, purchase flow                                                                                                                                                              |
| `packages/contracts`              | **New**         | Foundry package: per-seller `RevenueSplitter` + `SplitterFactory` (the x402 `payTo` destination) and their viem SDK. Design source is `documents/data-enriched-marketplaces.md` Step 4b, not the v1 catalog spec.              |

## Prototype Scope

### In scope

- `packages/swarm-catalog`: all TypeScript types (Appendix A), `SwarmCatalogBuilder` (stage + dryRun + publish), catalog feed management, per-item state feed management, JSON-LD serialization
- `packages/x402-swarm-server`: refactor to `POST /v1/items/:itemId/purchase` (three-phase), PurchaseIntent EIP-712 verification (12 steps), nonce store, state feed write post-grant, Mantaray catalog lookup, purchase record store, structured `ApiError` responses
- `packages/catalogue-feed-browser`: catalog feed → Mantaray traversal, list/detail view, sample preview, PurchaseIntent signing + purchase flow
- `packages/erc8004-adapter`: add `"swarm-ai-catalog"` services entry + `--catalog-feed-owner` CLI flag; fix `registrations[]` not being written back to Agent Card after on-chain registration

### Out of scope for prototype

- Crash recovery / publisher intent persistence (§12.5)
- Cursor pagination (§13.4)
- Bazaar indexer integration (§13.5)
- ENS registration of `swarm-ai-catalog.eth` (§18 open item)
- `GET /v1/catalog` and `GET /v1/state/:itemId` optional pass-through endpoints (§10.4, §10.5)
- Multi-publisher / federated catalogs (§18)
- Croissant 1.1 validator (§18 open item)

## Implementation Order

Each layer depends on the previous:

1. `packages/swarm-catalog` — types + builder (no downstream dependencies)
2. `packages/x402-swarm-server` — imports types from `swarm-catalog`
3. `packages/catalogue-feed-browser` — imports types from `swarm-catalog`, calls `x402-swarm-server`
4. `packages/erc8004-adapter` — independent minor addition

## Dev Environment

- **Node 22+**, **pnpm 9+** required (`engines` field enforced in root `package.json`)
- Install from monorepo root: `pnpm install`
- Local Bee node required at `http://localhost:1633` (light node is sufficient for testing)
- Copy `.env.example` → `.env` in each package before running (exists in `erc8004-adapter`, `x402-swarm-server`, `catalogue-feed-browser`)
- Run a package without a build step during prototyping: `npx tsx src/index.ts` from the package directory
- Run all packages in parallel: `pnpm dev` from root
- Test a single package: `pnpm --filter <package-name> test` (e.g. `pnpm --filter swarm-catalog test`)
- **Foundry** (`forge`) is required only for `packages/contracts`, and is not a pnpm dependency — install from https://getfoundry.sh, then `forge install` in that package. Its scripts skip with a warning when `forge` is absent so root `pnpm test` / `pnpm build` still work; CI should set `REQUIRE_FOUNDRY=1` to make the skip a failure
- Build all packages: `pnpm build`

## Key Environment Variables

| Variable                          | Package(s)                                              | Purpose                                                                                                          |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BEE_API_URL`                     | all                                                     | Bee node endpoint, default `http://localhost:1633`                                                               |
| `BEE_FEED_PK`                     | `swarm-catalog`, `x402-swarm-server`, `erc8004-adapter` | Catalog feed signer private key (cold key)                                                                       |
| `ITEM_STATE_FEED_PK`              | `x402-swarm-server`                                     | Per-item state feed signer private key (hot key, new var in refactor)                                            |
| `POSTAGE_BATCH_ID`                | `swarm-catalog`, `x402-swarm-server`                    | Postage stamp batch ID for uploads (note: `erc8004-adapter` uses `BEE_POSTAGE_STAMP` for the same concept)       |
| `CATALOG_FEED_OWNER`              | `x402-swarm-server`                                     | EOA address of the catalog feed signer — used to locate the catalog on Swarm (new var in refactor)               |
| `PURCHASE_INTENT_DOMAIN_CONTRACT` | `x402-swarm-server`                                     | `verifyingContract` address for EIP-712 `PurchaseIntent` domain (new var in refactor)                            |
| `FACILITATOR_URL`                 | `x402-swarm-server`                                     | x402 facilitator endpoint, default `https://x402.org/facilitator`                                                |
| `EVM_PRIVATE_KEY`                 | `catalogue-feed-browser`                                | Consumer wallet private key for signing `PurchaseIntent` and ERC-3009 authorization                              |
| `PRIVATE_KEY`                     | `erc8004-adapter`                                       | On-chain transaction signer for ERC-8004 registration                                                            |
| `RPC_URL`                         | `erc8004-adapter`                                       | EVM RPC endpoint                                                                                                 |
| `DB_PATH`                         | `x402-swarm-server`                                     | SQLite file path for nonce store + purchase records, default `./data/store.db`                                   |
| `SPLITTER_ADDRESS`                | `x402-swarm-server`                                     | This seller's splitter clone. When set, any other advertised `payTo` is rejected (`payment_destination_untaxed`) |
| `SPLITTER_FACTORY_ADDRESS`        | `swarm-market-mcp`                                      | `SplitterFactory` address used to resolve a seller's clone                                                       |
| `SELLER_ADDRESS`                  | `swarm-market-mcp`                                      | Seller whose splitter becomes `payment[].payTo` at catalog-build time                                            |

## Hackweek Code Note

`x402-swarm-server` and `catalogue-feed-browser` contain a working Hackweek POC that does **not** conform to the v1 spec. Treat existing code as reference only for Bee API call patterns (e.g. `patchGrantees`, feed read/write) — the route structure, wire format, catalogue lookup, and state model are all being replaced.

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
- **A priced listing's `payTo` is the seller's splitter clone, never a bare EOA.** Only settlements into the split contract are taxed, and only taxed sales produce a valid Proof-of-Purchase. Clone terms are frozen at creation because the buyer signs an EIP-712 `PurchaseIntent` over the exact `payTo`.
- **Purchase record must be written between steps 9 and 10** of the purchase flow — after `/settle`, before ACT grant. Never loses the record even if grant fails.

## Purchase Flow Summary (full detail in §10–§11 of spec and `x402-swarm-server/CLAUDE.md`)

**Phase 1** (no `X-Payment` header): return 402 with x402 challenge body including EIP-712 domain in `extra.purchaseIntentDomain`.

**Phase 2** (`X-Payment` header present): verify `PurchaseIntent` (12 steps per §11.5: parse → EIP-712 sig → domain match → item match → payment match → time window → nonce freshness → Facilitator `/verify` → Facilitator `/settle` → ACT grant → update state feed → return `ActGrantResult`). Purchase record is written between `/settle` and ACT grant (steps 9→10) as an implementation detail, not a spec step.

**On any failure before `/settle`**: return structured `ApiError`, no state change.
**On any failure after `/settle`**: return 500 `ApiError`; purchase record is already written; ACT grant MUST be retried until success.
