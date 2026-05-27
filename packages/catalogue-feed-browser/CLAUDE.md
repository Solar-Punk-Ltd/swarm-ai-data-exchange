# catalogue-feed-browser

Consumer-side server + UI for exploring Swarm AI catalogs and purchasing items via x402.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-26-final.md`

Read before implementing:

- Part 3 — Architecture Overview
- Part 4 — Feeds (how to resolve catalog feed → Mantaray root)
- Part 5 — Catalog Mantaray schema (directory layout, inline metadata)
- Part 9 — Sample data architecture
- Part 11 — PurchaseIntent EIP-712 (consumer constructs and signs this)
- Part 13 — Reader flow (full walkthrough)

## Current state

`src/` has stubs: `buyer.ts`, `catalogue.ts`, `index.ts`, `types.ts`. These predate the Mantaray-based spec and need to be replaced or significantly refactored.

## Responsibilities

This package is the **consumer side**. It does not write to Swarm or publish anything. It only reads and purchases.

### 1. Catalog reader (`src/reader.ts`)

Implements the reader flow from §13:

```typescript
// Resolve catalog feed → Mantaray root → enumerate items
listItems(catalogFeedOwner: string, bee: Bee): Promise<CatalogItemSummary[]>

// Fetch full item.jsonld for a single item
getItem(catalogFeedOwner: string, itemId: string, bee: Bee): Promise<CatalogItem>

// Fetch sample content references for an item
getSamplePaths(catalogFeedOwner: string, itemId: string, bee: Bee): Promise<string[]>
```

`CatalogItemSummary` is a lightweight type for list view — populated from inline Mantaray fork metadata (§5.5) when available, falling back to `item.jsonld` fields.

Catalog feed resolution:

- Topic: `CATALOG_FEED_TOPIC` constant from `swarm-catalog`
- Owner: passed in as `catalogFeedOwner` (read from Agent Card `"swarm-ai-catalog"` services entry)
- Feed payload: bare 64-char hex Mantaray root reference

### 2. Purchase flow (`src/buyer.ts` — refactor existing)

Consumer signs a `PurchaseIntent` and calls the publisher's purchase endpoint:

```typescript
purchase(params: {
  publisherEndpoint: string,  // e.g. https://publisher.example/v1/items/:itemId/purchase
  itemId: string,
  granteePublicKey: string,   // consumer's Bee-node public key
  walletSigner: WalletClient, // viem wallet for EIP-712 signing + ERC-3009 auth
}): Promise<ActGrantResult>
```

Three-phase flow (consumer side of §10.1):

1. POST without `X-Payment` → receive 402 with `purchaseIntentDomain` in `extra`
2. Build `PurchaseIntent` message, sign with EIP-712 (`PURCHASE_INTENT_TYPES` from `swarm-catalog`)
3. Build ERC-3009 `transferWithAuthorization` signature
4. Assemble `PurchasePayload` envelope, base64-encode, POST with `X-Payment` header
5. Return `ActGrantResult`

### 3. HTTP server (`src/index.ts` — refactor existing)

Express server exposing endpoints for the browser UI:

```
GET  /api/catalog/:owner/items          — list view (calls reader.listItems)
GET  /api/catalog/:owner/items/:itemId  — detail view (calls reader.getItem)
GET  /api/catalog/:owner/items/:itemId/sample  — sample content proxy
POST /api/purchase                      — triggers purchase flow
```

The browser UI is served as static files or rendered by this server.

### 4. UI

Simple read-only catalog browser:

- List view: tiles showing name, content type, price, tags from inline metadata
- Detail view: full `item.jsonld` rendered, sample preview
- Purchase button: triggers the purchase flow, displays `ActGrantResult`

## Types

Import all types (`CatalogItem`, `ActGrantResult`, `PurchasePayload`, `PURCHASE_INTENT_TYPES`, etc.) from `@solarpunk/swarm-catalog`. Do not redefine them here.

## Prototype exclusions

Do NOT implement:

- Cursor pagination (§13.4) — load all items for now
- Bazaar integration
- Multi-publisher aggregated view
- Post-purchase content streaming / decryption (display `actHistoryRef` as the result)

## Dependencies

```json
{
  "@solarpunk/swarm-catalog": "workspace:*",
  "@ethersphere/bee-js": "12.0.0",
  "viem": "^2.0.0",
  "@x402/fetch": "latest",
  "express": "^4.18.0"
}
```
