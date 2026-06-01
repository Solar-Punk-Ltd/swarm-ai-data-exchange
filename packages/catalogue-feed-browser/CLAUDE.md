# catalogue-feed-browser

Consumer-side server + UI for exploring Swarm AI catalogs and purchasing items via x402.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md`

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

// Fetch sample content references for an item (used by UI to know what to request)
// Returns Mantaray paths only — does NOT include encodingFormat.
// The sample proxy endpoint reads item.jsonld.sample directly for encodingFormat; do not thread getSamplePaths() through the proxy handler.
getSamplePaths(catalogFeedOwner: string, itemId: string, bee: Bee): Promise<string[]>
```

`CatalogItemSummary` is a lightweight type for list view — populated from inline Mantaray fork metadata (§5.5) when available. If inline metadata is absent or incomplete, fall back to fetching `item.jsonld`. When both exist and conflict, `item.jsonld` is authoritative — MUST prefer it (§5.5: _"A consumer noticing a mismatch between inline metadata and `item.jsonld` MUST prefer `item.jsonld`"_).

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

Nine-step flow (consumer side of §10.1 and §11.4). Both signatures share the same nonce and time window — this is a hard invariant the server verifies at steps 3–6 of its 12-step verification:

1. POST without `X-Payment` header → receive 402 with `accepts[]` and `purchaseIntentDomain` in `extra`
2. Select one `accepts` entry (scheme, asset, amount, payTo)
3. Generate a random `nonce` (bytes32) and time window (`validAfter`, `validBefore`)
4. Build `PurchaseIntentMessage` (itemId, granteePublicKey, payment from step 2, nonce + window from step 3)
5. Sign `PurchaseIntent` with EIP-712 using `domain` from `extra.purchaseIntentDomain` and `PURCHASE_INTENT_TYPES` from `swarm-catalog`
6. Sign ERC-3009 `transferWithAuthorization` with the **same wallet**, **same nonce**, **same window** — `to` = `payTo`, `value` = `amount`
7. Assemble `PurchasePayload` envelope (`purchaseIntent` + `authorization`), base64-encode → `X-Payment` header value
8. POST again with `X-Payment` header and `{ granteePublicKey }` body
9. Return `ActGrantResult`

### 3. HTTP server (`src/index.ts` — refactor existing)

Express server exposing endpoints for the browser UI:

```
GET  /api/catalog/:owner/items          — list view (calls reader.listItems)
GET  /api/catalog/:owner/items/:itemId  — detail view (calls reader.getItem)
GET  /api/catalog/:owner/items/:itemId/sample  — sample content proxy (see below)
POST /api/purchase                      — triggers purchase flow
```

**Sample proxy** (`GET /api/catalog/:owner/items/:itemId/sample`) implements §13.3:

1. Fetch `item.jsonld` and read the `sample` descriptor (`SampleSpec.path`, `encodingFormat`)
2. Fetch the sample blob(s) from `/items/{itemId}/sample/...` paths via Bee
3. Proxy bytes to client with correct `Content-Type`

The UI MUST label sample content clearly as a sample/preview, not the full asset (§13.3 requirement). Do not stream the priced content — the sample lives at `sample/` paths and is always open-access (no ACT).

The browser UI is served as static files or rendered by this server.

### 4. UI

Simple read-only catalog browser:

- List view: tiles showing name, content type, price, tags from inline metadata
  - MUST show `active` and `deprecated` items
  - SHOULD show `retired` items (so prior purchasers can find them) — MUST visually mark them as retired and hide the purchase button
  - Do NOT filter out any lifecycle state client-side — the spec keeps all entries for discovery
- Detail view: full `item.jsonld` rendered, sample preview
- Purchase button: triggers the purchase flow, displays `ActGrantResult`; hidden for `retired` items

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
  "express": "^4.18.0"
}
```

**Note:** `@x402/fetch` is NOT used for the purchase flow and should be removed from `package.json`. The purchase flow is implemented manually in `buyer.ts` using:

- **`viem`** (`signTypedData`) — EIP-712 signing for `PurchaseIntent` and ERC-3009 `transferWithAuthorization`
- **native `fetch`** — the two-phase POST (phase 1 without `X-Payment`, phase 2 with it) needs no library
- **`@solarpunk/swarm-catalog`** — `PURCHASE_INTENT_TYPES`, `PurchasePayload`, `PurchaseIntentMessage` types

The existing `buyer.ts` stub uses `@x402/fetch` — that is Hackweek code being replaced entirely.
