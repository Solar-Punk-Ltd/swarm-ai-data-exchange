# @solarpunk/swarm-catalog

Publisher SDK for the **Swarm AI Data Exchange** catalog protocol — the TypeScript types, the
`SwarmCatalogBuilder`, and the catalog / per-item state feed management used to publish AI data
assets to the [Ethswarm](https://www.ethswarm.org/) network.

The Swarm AI Data Exchange is a decentralized marketplace where AI agents publish, discover, and
purchase data assets. Assets are stored on Swarm, encrypted with **ACT** (Access Control Trie),
and gated by **x402** micropayments. This package is the publisher-side layer: it turns a set of
data assets into an on-Swarm catalog that consumers can browse and buy from. It has no dependency
on the other packages in the system; the purchase server and consumer browser import their wire
types and path helpers from here.

## Concepts

A **catalog** is a [Mantaray](https://docs.ethswarm.org/docs/develop/tools-and-features/mantaray/)
manifest (a content-addressed directory tree) stored on Swarm. It contains one `item.jsonld`
document per asset plus a collection-level `catalog.jsonld`. The manifest's root reference is
published to a **catalog feed** — a Swarm feed (mutable pointer) that always points at the latest
catalog root.

Each priced asset additionally has a **per-item state feed** that tracks its mutable ACT state
(the `actHistoryRef` and `granteeRef`, which advance every time access is granted to a new buyer).
The catalog itself never carries this mutable state — it stays in the state feed so the catalog
root only changes when the _catalog_ changes, not on every purchase.

```
catalog feed ──► Mantaray root ──┬─► /catalog.jsonld
(latest root)                    ├─► /items/{itemId}/item.jsonld
                                 └─► /items/{itemId}/{sample}

per-item state feed ──► CatalogItemState JSON  (actHistoryRef, granteeRef, …)
```

### Key invariants

These constraints are load-bearing — the protocol depends on them:

- **All priced content is ACT-protected.** There is no per-item "encrypted" flag; if it has a
  price, it is ACT-wrapped.
- **The catalog feed payload is a bare 64-character hex string** (the Mantaray root reference) —
  not JSON, not an envelope.
- **The catalog feed topic is a fixed protocol constant:** `keccak256("swarm-ai-catalog.v1")`. No
  chain, registry, or agent identity is encoded in it.
- **The per-item state feed topic binds the feed to its catalog:**
  `keccak256("swarm-ai-catalog-state.v1" || catalogFeedOwner || itemId)`. This prevents a state
  feed from being reattached to a different catalog.
- **`itemId` equals the priced content's Swarm reference** (the 64-char hex content address). The
  content address _is_ the item identifier.
- **The ACT history reference lives in `CatalogItemState`, never in `item.jsonld`.** It advances
  per grant and must not pollute the catalog.
- **The state feed is verification-only for consumers** — never a discovery, notification, or
  popularity channel.
- **Two separate feed signers:** the catalog feed signer is a low-frequency **cold key**; the
  per-item state feed signer is a high-frequency **hot key** (it signs on every purchase). They
  must not be the same key.

## Installation

This package is part of the monorepo and is not published standalone. From the repo root:

```bash
pnpm install
```

**Requirements:** Node 22+, pnpm 9+. _Publishing_ (not testing) additionally needs a running Bee
node at `http://localhost:1633` and a funded postage batch.

```json
{
  "@ethersphere/bee-js": "12.0.0",
  "ethers": "^6.13.0"
}
```

## Source layout

```
src/
  types.ts    — all data-model and wire types
  feeds.ts    — feed topic derivation + catalog feed read
  paths.ts    — catalog Mantaray path schema
  jsonld.ts   — CatalogItem → item.jsonld / catalog.jsonld serialization
  state.ts    — CatalogItemState read/write helpers
  builder.ts  — SwarmCatalogBuilder
  index.ts    — barrel export
```

## Data model

All types are exported from the package root.

### `CatalogItem` — publisher input

The type you construct and hand to the builder.

```ts
interface CatalogItem {
  id: string; // 64-char hex; MUST equal storage.reference
  name: string;
  description: string;
  content: ContentSpec; // discriminated union, see below
  storage: SwarmStorage;
  payment: PaymentRequirements[]; // must be non-empty
  sample?: SampleSpec;
  license?: string; // URL or SPDX id (e.g. "MIT", "CC-BY-4.0")
  tags?: string[];
  version?: string;
  lifecycle: 'active' | 'deprecated' | 'retired';
  supersededBy?: string; // itemId, when deprecated
  dateAdded: string; // ISO 8601
  dateModified: string; // ISO 8601
}

interface SwarmStorage {
  reference: string; // 64-char hex, encrypted (ACT) content reference
  contentSize?: number;
}

interface PaymentRequirements {
  scheme: 'exact'; // v1: only 'exact'
  chainId: string; // CAIP-2, e.g. "eip155:84532"
  asset: string; // CAIP-19 token identifier
  amount: string; // smallest-unit, decimal string
  payTo: string; // 0x address receiving payment
  facilitator?: string; // URL
  description?: string;
}

interface SampleSpec {
  kind: 'subset' | 'clip' | 'thumbnail' | 'manifest';
  path: string; // relative path, becomes /items/{itemId}/{path}
  encodingFormat?: string;
  contentSize?: number;
}
```

### `ContentSpec` — content-type discriminated union

`content.type` selects one of seven shapes. Field names follow schema.org where it has an
equivalent; `swarm-cat:`-prefixed fields below are protocol extensions.

| `type`     | Required fields                                 | Optional fields                                             |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `image`    | `encodingFormat`, `width`, `height`             | `contentSize`, `colorSpace`                                 |
| `video`    | `encodingFormat`, `width`, `height`, `duration` | `contentSize`, `bitrate`, `fps`, `codec`, `hasAudio`        |
| `audio`    | `encodingFormat`, `duration`                    | `contentSize`, `bitrate`, `codec`, `channels`, `sampleRate` |
| `text`     | `encodingFormat`                                | `contentSize`, `wordCount`, `inLanguage`                    |
| `document` | `encodingFormat`                                | `contentSize`, `wordCount`, `inLanguage`                    |
| `dataset`  | `encodingFormat`                                | `contentSize`, `recordSets` (Croissant), `isMultiFile`      |
| `bytes`    | `encodingFormat`                                | `contentSize`, `modelArchitecture`, `parameters`            |

`duration` is an ISO 8601 duration string (e.g. `"PT12M34S"`). `inLanguage` is BCP-47. A `dataset`
may carry `recordSets: { name, fields: { name, dataType }[] }[]`, where `dataType` is a schema.org
type such as `"sc:Text"` or `"sc:Integer"`.

The union exports a derived `ContentType` alias (`= ContentSpec['type']`) for code that needs the
set of type discriminants.

### Wire types

```ts
// Mutable per-item state, stored behind the per-item state feed.
interface CatalogItemState {
  itemId: string;
  actHistoryRef: string; // current ACT history reference; advances per grant
  granteeRef: string; // current grantee-list reference; advances per grant
  lifecycle: 'active' | 'deprecated' | 'retired';
  version?: string;
  catalogRootAtUpdate?: string;
  dateModified: string;
}

// Returned to the buyer after a successful ACT grant.
interface ActGrantResult {
  itemId: string;
  actHistoryRef: string;
  grantTo: string; // hex pubkey
  reference: string;
  txHash: string;
  grantedAt: string; // ISO 8601
  expiresAt?: string; // ISO 8601
}

// Structured error body.
interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}
```

### Purchase / EIP-712 types

The package also exports the types and descriptors used by the purchase flow: `Eip712Domain`,
`PurchaseIntentMessage`, the `PURCHASE_INTENT_TYPES` EIP-712 type descriptor, and the full decoded
`PurchasePayload` envelope (the `X-Payment` header contents — an x402 `purchaseIntent` plus an
ERC-3009 `authorization`). These exist so the purchase server and consumer share one definition of
the signed message; this package does not itself perform signing or verification.

## Catalog layout & serialization

### Mantaray paths

The `paths.ts` helpers are the single source of truth for the manifest layout, shared with the
reader side so publisher and consumer never drift:

```ts
itemManifestPath(itemId); // → "/items/{itemId}/item.jsonld"
itemSamplePath(itemId, samplePath); // → "/items/{itemId}/{samplePath}"
CATALOG_MANIFEST_PATH; // === "/catalog.jsonld"
```

### JSON-LD

Each item serializes to an `item.jsonld` document and the collection to a `catalog.jsonld`. Both
use the `@context` document `"https://swarm-ai-catalog.eth/v1"`.

Items are co-typed: the `@type` array always starts with `"swarm-cat:CatalogItem"` and adds the
matching schema.org (and, for datasets, Croissant) types:

| `content.type` | `@type`                                                 |
| -------------- | ------------------------------------------------------- |
| `image`        | `["swarm-cat:CatalogItem", "sc:ImageObject"]`           |
| `video`        | `["swarm-cat:CatalogItem", "sc:VideoObject"]`           |
| `audio`        | `["swarm-cat:CatalogItem", "sc:AudioObject"]`           |
| `text`         | `["swarm-cat:CatalogItem", "sc:TextDigitalDocument"]`   |
| `document`     | `["swarm-cat:CatalogItem", "sc:CreativeWork"]`          |
| `dataset`      | `["swarm-cat:CatalogItem", "cr:Dataset", "sc:Dataset"]` |
| `bytes`        | `["swarm-cat:CatalogItem", "sc:MediaObject"]`           |

Standard schema.org property names are used where they exist (`encodingFormat`, `width`, `height`,
`duration`, `contentSize`, `inLanguage`, `wordCount`, `bitrate`); protocol extensions use the
`swarm-cat:` prefix (`colorSpace`, `fps`, `codec`, `hasAudio`, `channels`, `sampleRate`,
`isMultiFile`, `modelArchitecture`, `parameters`, `supersededBy`). The `catalog.jsonld` is typed
`["sc:DataCatalog", "swarm-cat:Catalog"]` and carries `swarm-cat:itemCount` and
`swarm-cat:protocolVersion` ("1.0").

## Feeds

```ts
import { CATALOG_FEED_TOPIC, stateFeedTopic, readCatalogFeedRoot } from '@solarpunk/swarm-catalog';
import { readItemState, writeItemState, NoStateFeedError } from '@solarpunk/swarm-catalog';

// Fixed catalog feed topic — keccak256("swarm-ai-catalog.v1"), a 0x-prefixed hex string.
CATALOG_FEED_TOPIC;

// Per-item state feed topic, bound to its catalog owner + itemId.
stateFeedTopic(catalogFeedOwner, itemId);

// Read the catalog feed → bare 64-char hex Mantaray root. Throws if never published.
await readCatalogFeedRoot(bee, catalogFeedOwner);

// Read / write the per-item state. readItemState throws NoStateFeedError if uninitialized.
// stateFeedOwner is the hot state-feed signer's EOA — it owns the feed; catalogFeedOwner only computes the topic.
await readItemState(bee, catalogFeedOwner, itemId, stateFeedOwner);
await writeItemState(bee, itemStateFeedSigner, catalogFeedOwner, state, postageBatchId);
```

The `catalogFeedOwner` is the EOA address of the catalog feed signer; it's what the per-item state
feed topic binds to. `writeItemState` uploads the state JSON to Swarm and points the feed at it,
returning the new Swarm reference.

## `SwarmCatalogBuilder`

Stages changes, validates them, and publishes the catalog in one `publish()` call.

```ts
import { Bee } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder, type CatalogItem } from '@solarpunk/swarm-catalog';

const bee = new Bee('http://localhost:1633');

const builder = new SwarmCatalogBuilder({
  bee,
  catalogFeedSigner, // cold key — signs the catalog feed (low frequency)
  itemStateFeedSigner, // hot key  — signs per-item state feeds (per purchase)
  postageBatchId,
});

const item: CatalogItem = {
  id: contentRef, // === storage.reference
  name: 'Curated image set',
  description: 'High-res training images',
  content: { type: 'image', encodingFormat: 'image/png', width: 1024, height: 1024 },
  storage: { reference: contentRef },
  payment: [{ scheme: 'exact', chainId: 'eip155:84532', asset, amount: '1000000', payTo }],
  license: 'CC-BY-4.0',
  sample: { kind: 'thumbnail', path: 'sample/thumb.png' },
  lifecycle: 'active',
  dateAdded: new Date().toISOString(),
  dateModified: new Date().toISOString(),
};

builder.stageItem(item); // validates now; throws on invalid input
builder.stageSampleData(item.id, sampleBytes); // raw bytes for the sample asset
builder.seedActState(item.id, { actHistoryRef, granteeRef }); // required for every priced item

const { catalogRoot, feedUpdateTxId, stateFeeds } = await builder.publish();
```

### API

| Method                                                | Purpose                                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `stageItem(item)`                                     | Queue an item for the next publish. Validates immediately and throws on invalid input.                                                  |
| `stageRemove(itemId)`                                 | Queue removal of an item's `item.jsonld` from the catalog.                                                                              |
| `stageLifecycle(itemId, lifecycle)`                   | Queue a lifecycle change for an item already in the catalog.                                                                            |
| `stageSampleData(itemId, data)`                       | Provide raw sample bytes (`Uint8Array \| string`) to upload and link at `/items/{itemId}/{sample.path}`.                                |
| `seedActState(itemId, { actHistoryRef, granteeRef })` | Provide the initial ACT refs for a priced item. **Required before `publish()` for every item with a non-empty `payment` array.**        |
| `dryRun()`                                            | Compute the resulting Mantaray locally without uploading. Returns `{ root: '', manifest }` (root is empty because nothing is uploaded). |
| `publish()`                                           | Upload everything and push the feed updates. Returns `{ catalogRoot, feedUpdateTxId, stateFeeds: { itemId, reference }[] }`.            |

### What `publish()` does

1. Apply any staged lifecycle changes to staged items.
2. Verify every priced staged item has an ACT seed (throws if missing).
3. Load the previous catalog Mantaray from the feed (copy-on-write), or start fresh if the feed has
   never been published.
4. For each staged item: upload its sample bytes (if any) and its serialized `item.jsonld`, linking
   both into the manifest.
5. Apply staged removals and lifecycle-only changes.
6. Serialize and upload `catalog.jsonld`.
7. Save the Mantaray and capture the new root reference.
8. Push the catalog feed update (bare 64-char hex root).
9. Initialize/update each priced item's state feed from its ACT seed.

> **Caller responsibilities (not done by the builder).** You must, before staging: (a) upload the
> priced content to Swarm and ACT-wrap it, then pass its reference as both `item.id` and
> `item.storage.reference`; and (b) capture the initial `actHistoryRef` and `granteeRef` from the
> ACT-wrapping step and pass them via `seedActState`. The builder takes pre-uploaded,
> ACT-protected content references — it does not perform encryption itself.

### Validation rules

`stageItem` **throws** when:

- `id` does not equal `storage.reference`
- `payment` is empty
- `lifecycle` is not one of `active` / `deprecated` / `retired`
- `encodingFormat` is missing
- `width`/`height` are missing for `image` or `video`
- `duration` is missing for `video` or `audio`
- a URL-shaped field (`license`, `payment[].facilitator`) is not a valid URL

`stageItem` **warns** (logs, does not throw) when:

- `license` is missing
- `tags` exceed 20 entries (soft cap)
- a priced item with amount ≥ 1,000,000 (≈ 1 USDC) has no `sample`

## Testing

Tests use **Jest** with **ts-jest**, and **`@ethersphere/bee-js` is mocked** — so the entire suite
runs without a live Bee node, real Mantaray, postage batch, or any environment configuration.

From the repo root:

```bash
pnpm --filter swarm-catalog test
```

From this package directory:

```bash
pnpm test           # run the Jest suite
pnpm typecheck      # tsc --noEmit
```

### Coverage

| Test file                      | Covers                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `test/types.test.ts`           | Type shapes / discriminated-union assignability               |
| `test/feeds.test.ts`           | Catalog feed constant, state feed topic derivation, feed read |
| `test/jsonld.test.ts`          | `item.jsonld` / `catalog.jsonld` serialization + co-typing    |
| `test/state.test.ts`           | `readItemState` / `writeItemState` (incl. `NoStateFeedError`) |
| `test/builder.test.ts`         | Staging, validation rules, warnings, `dryRun`                 |
| `test/builder.publish.test.ts` | `publish()` happy path against the mocked Bee                 |

### Writing a test against the mocked Bee

Mock `@ethersphere/bee-js` before importing the builder, then exercise the public API and assert on
the mock. Sketch:

```ts
jest.mock('@ethersphere/bee-js', () => {
  class MantarayNode {
    addFork = jest.fn();
    removeFork = jest.fn();
    saveRecursively = jest
      .fn()
      .mockResolvedValue({ reference: { toString: () => '1'.repeat(64) } });
    static unmarshal = jest.fn();
  }
  class PrivateKey {
    constructor(_k: unknown) {}
    publicKey() {
      return { address: () => ({ toHex: () => '00'.repeat(20) }) };
    }
  }
  return { MantarayNode, PrivateKey };
});

import { SwarmCatalogBuilder } from '../src/builder.js';
// ...stage a valid item, seedActState, call publish(), assert on the returned root / mock calls.
```

## Scripts

| Script           | Description                |
| ---------------- | -------------------------- |
| `pnpm build`     | `tsc` — compile to `dist/` |
| `pnpm dev`       | `tsx src/index.ts`         |
| `pnpm test`      | Run the Jest suite         |
| `pnpm typecheck` | `tsc --noEmit`             |
