# swarm-catalog

Publisher SDK for the Swarm AI Data Exchange catalog protocol. New package — nothing exists yet.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-26-final.md`

Read before implementing:

- Appendix A — TypeScript reference types (implement these exactly, field names are normative)
- Part 4 — Feed management (catalog feed + per-item state feeds)
- Part 5 — Catalog Mantaray schema (directory layout, inline fork metadata)
- Part 6 — Data model (SwarmStorage, PaymentRequirements, CatalogItem, CatalogItemState, ActGrantResult)
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
// Returns 0x-prefixed hex string (ethers keccak256 return type)
export function stateFeedTopic(catalogFeedOwner: string, itemId: string): string {
  return keccak256(
    concat([
      toUtf8Bytes('swarm-ai-catalog-state.v1'),
      getBytes(catalogFeedOwner), // 20-byte EOA address
      toUtf8Bytes(itemId), // 64-char hex itemId
    ]),
  );
}
// bee-js 12.x makeFeedWriter accepts string topics directly — no getBytes conversion needed
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

Constructor (matches Appendix A.4 exactly — keep these names and types):

```typescript
new SwarmCatalogBuilder({
  bee: Bee,
  catalogFeedSigner: FeedSigner, // cold key — signs catalog feed updates
  itemStateFeedSigner: FeedSigner, // hot key — signs per-item state feed updates
  postageBatchId: string,
});
```

`FeedSigner` is bee-js's signing primitive. The builder constructs `FeedWriter` instances internally. Confirmed bee-js 12.0.0 signature (no feed-type string argument):

```typescript
bee.makeFeedWriter(topic: Topic | Uint8Array | string, signer?: PrivateKey | Uint8Array | string): FeedWriter
```

`topic` accepts a `string` directly — the 0x-prefixed hex from `keccak256(...)` can be passed as-is without `getBytes` conversion. `signer` is optional if provided in the `Bee` constructor but SHOULD be passed explicitly here. One `FeedWriter` is created per feed: one for the catalog feed topic, one per item's state feed topic.

Public API (signatures from Appendix A.4 are normative — keep them exact):

- `stageItem(input: CatalogItem): void` — queue an item for the next publish (matches Appendix A)
- `stageRemove(itemId: string): void` — queue a removal
- `stageLifecycle(itemId: string, lifecycle: 'active' | 'deprecated' | 'retired'): void` — queue a lifecycle change
- `dryRun(): Promise<{ root: string, manifest: any }>` — compute the new Mantaray locally without uploading
- `publish(): Promise<{ catalogRoot: string, feedUpdateTxId: string, stateFeeds: Array<{itemId, reference}> }>`

**Prototype-only extension** (not in Appendix A):

- `seedActState(itemId: string, state: { actHistoryRef: string, granteeRef: string }): void` — provide the initial ACT history and grantee refs for a staged item, so `publish()` can write the initial state feed at step 7.

This extra method exists because the spec's §12.2 step 2 (ACT wrapping) is the caller's responsibility in this prototype, not the builder's. The caller wraps the content with ACT, captures the initial `actHistoryRef` and `granteeRef`, and passes them in via `seedActState` before calling `publish()`. In a production implementation aligned with the full spec, the builder would handle ACT wrapping itself and `seedActState` would not exist.

The `publish()` method maps to spec §12.2's 8 steps. Spec steps 1 and 2 are delegated to the caller in this prototype, so `publish()` itself performs 6 numbered actions (3–8 below). The full mapping:

| Spec step                                                         | Where it happens in the prototype                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Upload priced content                                          | **Delegated to caller** before `stageItem()`. Reference is passed in as `item.storage.reference` and `item.id`.                                                                                   |
| 2. Wrap with ACT (capture initial `actHistoryRef` + `granteeRef`) | **Delegated to caller** before `seedActState()`. The two refs are passed in via `seedActState(itemId, { actHistoryRef, granteeRef })`.                                                            |
| 3. Upload samples                                                 | Inside `publish()`                                                                                                                                                                                |
| 4. Build and upload `item.jsonld` (+ `catalog.jsonld`)            | Inside `publish()` — capture all references before touching the Mantaray                                                                                                                          |
| 5. Build/update the catalog Mantaray                              | Inside `publish()` — incorporate `/catalog.jsonld` + all `/items/{itemId}/item.jsonld` + sample nodes; copy-on-write from the last catalog root if the feed has one, otherwise build from scratch |
| 6. Upload the new Mantaray                                        | Inside `publish()` — capture root reference                                                                                                                                                       |
| 7. Push catalog feed update with the new root                     | Inside `publish()` — bare 64-char hex payload, no envelope                                                                                                                                        |
| 8. Initialize/update per-item state feeds                         | Inside `publish()` — uses the ACT refs from `seedActState()`                                                                                                                                      |

**Note:** For the prototype, the builder receives pre-uploaded, ACT-protected content references. ACT encryption (wrapping content with `bee.createActSession` / initial grantees) is the caller's responsibility before calling `stageItem`.

## Validation rules (§12.3)

The builder MUST reject inputs that violate any of these rules (throw on `stageItem`):

- `id` does not equal `storage.reference`
- `payment` array is empty
- `lifecycle` is not one of `"active" | "deprecated" | "retired"`
- `license` is missing or empty — treating as MUST-reject for the prototype.
  The spec data model (§6.3) marks it Required and the TypeScript type has no `?`;
  §12.3 only SHOULDs a warning, but for the prototype strict enforcement is preferable
  to silently publishing unlicensed content.
- Required fields per content type are missing:
  - `image` / `video`: `width`, `height`
  - `video` / `audio`: `duration`
  - all types: `encodingFormat`
- Any URL field is not a valid IRI (`license` URL, `payment[].facilitator`, `swarm-cat:supersededBy` if present)

The builder SHOULD warn (log, do not throw) on:

- `tags` exceeding 20 entries (soft cap)
- `sample` missing on items where `payment[0].amount` indicates a non-trivial price (suggested threshold: ≥ 1 USDC equivalent)

**Spec inconsistency to skip:** §12.3 also lists rules about `publisher.chainId` and `publisher.registry`, but no `publisher` field exists on `CatalogItem` in §6.3 or Appendix A — and §5.2 explicitly states the catalog carries no agent-identity fields. These two rules reference non-existent fields and should be ignored as a spec drafting leftover. Agent attribution lives in the Agent Card (§3.4), not the catalog item.

## state.ts

Helpers used by both the builder and `x402-swarm-server`:

```typescript
// Read current state from per-item state feed
readItemState(bee: Bee, catalogFeedOwner: string, itemId: string): Promise<CatalogItemState>

// Write updated state after a grant
// `signer` is a bee-js FeedSigner; the helper constructs the FeedWriter internally using stateFeedTopic(catalogFeedOwner, state.itemId)
// Returns the Swarm reference of the newly-uploaded state JSON (the same value the feed update now points at)
writeItemState(bee: Bee, signer: FeedSigner, catalogFeedOwner: string, state: CatalogItemState, postageBatchId: string): Promise<string>
```

## Prototype exclusions

Do NOT implement:

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
