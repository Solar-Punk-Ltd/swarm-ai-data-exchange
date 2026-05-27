# swarm-catalog

Publisher SDK for the Swarm AI Data Exchange catalog protocol. New package — nothing exists yet.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-26-final.md`

Read before implementing:

- Appendix A — TypeScript reference types (implement these exactly, field names are normative)
- Part 4 — Feed management (catalog feed + per-item state feeds)
- Part 5 — Catalog Mantaray schema (directory layout, inline fork metadata)
- Part 6 — Data model (CatalogItem, CatalogItemState, ActGrantResult)
- Part 7 — JSON-LD serialization rules
- Part 12 — Publisher flow (the 8-step publish sequence)

## Planned source layout

```
src/
  types.ts        — all types from Appendix A
  feeds.ts        — feed topic derivation, feed read/write helpers
  jsonld.ts       — serialize CatalogItem → item.jsonld, collection → catalog.jsonld
  builder.ts      — SwarmCatalogBuilder
  state.ts        — CatalogItemState read/write helpers
  index.ts        — barrel export
```

## types.ts

Implement all types from Appendix A verbatim:

- `SwarmStorage`
- `PaymentRequirements`
- `ContentSpec` — discriminated union: `ImageContent | VideoContent | AudioContent | TextContent | DocumentContent | DatasetContent | BytesContent`
- `SampleSpec`
- `CatalogItem` — publisher input type
- `CroissantRecordSet`, `CroissantField`
- `CatalogItemState` — wire type, primary purpose is tracking ACT state (actHistoryRef + granteeRef)
- `ActGrantResult` — wire type
- `ApiError` — wire type
- `Eip712Domain`, `PurchaseIntentMessage`, `PURCHASE_INTENT_TYPES`, `PurchasePayload`

## feeds.ts

Two feed topics:

```typescript
// Fixed protocol constant — no chain or agent identity encoded
export const CATALOG_FEED_TOPIC = keccak256(toUtf8Bytes('swarm-ai-catalog.v1'));

// Per-item — binds state feed to its catalog
export function stateFeedTopic(catalogFeedOwner: string, itemId: string): Uint8Array {
  return keccak256(
    concat([
      toUtf8Bytes('swarm-ai-catalog-state.v1'),
      getBytes(catalogFeedOwner), // 20-byte EOA address
      toUtf8Bytes(itemId), // 64-char hex itemId
    ]),
  );
}
```

Catalog feed payload is a **bare 64-char hex string** — not JSON, not an envelope.

## jsonld.ts

Serialize `CatalogItem` to `item.jsonld`. Co-type correctly per §7.4:

| `ContentSpec.type` | `@type` array                                           |
| ------------------ | ------------------------------------------------------- |
| `image`            | `["swarm-cat:CatalogItem", "sc:ImageObject"]`           |
| `video`            | `["swarm-cat:CatalogItem", "sc:VideoObject"]`           |
| `audio`            | `["swarm-cat:CatalogItem", "sc:AudioObject"]`           |
| `text`             | `["swarm-cat:CatalogItem", "sc:TextDigitalDocument"]`   |
| `document`         | `["swarm-cat:CatalogItem", "sc:CreativeWork"]`          |
| `dataset`          | `["swarm-cat:CatalogItem", "cr:Dataset", "sc:Dataset"]` |
| `bytes`            | `["swarm-cat:CatalogItem", "sc:MediaObject"]`           |

Use schema.org property names where schema.org has them (`encodingFormat`, `width`, `height`, `duration`, `contentSize`, `inLanguage`, `wordCount`, `bitrate`). Use `swarm-cat:` prefix only for extensions the spec defines (`colorSpace`, `fps`, `codec`, `hasAudio`, `channels`, `sampleRate`, `modelArchitecture`, `parameters`, `isMultiFile`).

`@context` is `"https://swarm-ai-catalog.eth/v1"`.

## builder.ts — SwarmCatalogBuilder

Constructor:

```typescript
new SwarmCatalogBuilder({
  bee: Bee,
  catalogFeedSigner: FeedWriter, // cold key — signs catalog feed updates
  itemStateFeedSigner: FeedWriter, // hot key — signs per-item state feed updates
  postageBatchId: string,
});
```

Public API:

- `stageItem(input: CatalogItem, initialActState?: { actHistoryRef: string, granteeRef: string }): void` — queue an item for the next publish. For the prototype, the caller must provide `initialActState` because the builder initializes the state feed (step 8).
- `stageRemove(itemId: string): void` — queue a removal
- `stageLifecycle(itemId: string, lifecycle): void` — queue a lifecycle change
- `publish(): Promise<{ catalogRoot: string, feedUpdateTxId: string, stateFeeds: Array<{itemId, reference}> }>`

The `publish()` method implements the 8-step flow from §12.2:

1. Upload priced content to Swarm (already ACT-protected by caller — builder receives the reference)
2. Upload samples to Swarm
3. Build `item.jsonld` for each staged item and upload
4. Build/update the catalog Mantaray (copy-on-write from last root if feed has one, otherwise new)
5. Upload the new Mantaray, capture root reference
6. Push catalog feed update with bare root reference
7. Upload `catalog.jsonld` (collection-level document)
8. Initialize/update per-item state feeds for new/changed items

**Note:** For the prototype, the builder receives pre-uploaded, ACT-protected content references. ACT encryption (wrapping content with `bee.createActSession` / initial grantees) is the caller's responsibility before calling `stageItem`.

## state.ts

Helpers used by both the builder and `x402-swarm-server`:

```typescript
// Read current state from per-item state feed
readItemState(bee: Bee, catalogFeedOwner: string, itemId: string): Promise<CatalogItemState>

// Write updated state after a grant
writeItemState(bee: Bee, signer: FeedWriter, catalogFeedOwner: string, state: CatalogItemState, postageBatchId: string): Promise<string>
```

## Prototype exclusions

Do NOT implement:

- `dryRun()` on `SwarmCatalogBuilder`
- Crash recovery / intent persistence (§12.5)
- Inline Mantaray fork metadata (§5.5) — set empty metadata for now, add later
- Croissant 1.1 field validation

## Dependencies

```json
{
  "@ethersphere/bee-js": "12.0.0",
  "ethers": "^6.13.0"
}
```
