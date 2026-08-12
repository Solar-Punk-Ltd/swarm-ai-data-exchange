# swarm-market-mcp

MCP (Model Context Protocol) server exposing Swarm Data Enriched AI marketplace operations to LLM agents.

This package lets an agent **publish a catalog of priced, ACT-protected AI data assets** to Swarm through a single MCP tool. It wraps the `@solarpunk/swarm-catalog` publisher SDK (`SwarmCatalogBuilder`) so any agent that mounts this server can build and push a catalog without re-implementing Mantaray, feed, or state-feed plumbing.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md`

Read before changing the builder integration:

- Part 5 — Catalog Mantaray schema
- Part 6 — Data model (`CatalogItem`, `CatalogItemState`)
- Part 12 — Publisher flow (the 8-step publish sequence the tool drives)
- Appendix A — TypeScript reference types (the tool's item input mirrors `CatalogItem`)

## Tools

### `build_catalog`

Stages one or more `CatalogItem`s and publishes them as a Swarm catalog: uploads samples + `item.jsonld` + `catalog.jsonld`, builds/updates the catalog Mantaray (copy-on-write from the prior root), pushes the catalog feed, and initializes each item's per-item state feed.

It is a thin orchestration layer over `SwarmCatalogBuilder` from `@solarpunk/swarm-catalog`. Do not reimplement builder logic here — import and call it.

**Args** (`src/tools/build_catalog/models.ts`):

```typescript
export interface BuildCatalogArgs {
  // One or more items to stage. Each mirrors swarm-catalog's CatalogItem
  // (id MUST equal storage.reference; payment MUST be non-empty).
  items: BuildCatalogItem[];
  // Optional collection-level metadata for /catalog.jsonld (§5.2).
  catalogMeta?: { name?: string; description?: string; license?: string };
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}

export interface BuildCatalogItem {
  item: CatalogItem; // from @solarpunk/swarm-catalog
  // REQUIRED for every priced item: the ACT refs the caller captured when
  // ACT-wrapping the content. Maps to builder.seedActState(itemId, ...).
  actSeed: { actHistoryRef: string; granteeRef: string };
  // Optional sample bytes (base64 or utf-8) → builder.stageSampleData(itemId, ...).
  sampleData?: string;
}
```

**Return** (`getResponseWithStructuredContent`), the `publish()` result:

```typescript
{
  catalogRoot: string; // new Mantaray root reference
  feedUpdateTxId: string; // catalog feed update reference
  stateFeeds: Array<{ itemId: string; reference: string }>;
}
```

**Internal flow** (per item, then publish once):

1. Construct `SwarmCatalogBuilder({ bee, catalogFeedSigner, itemStateFeedSigner, postageBatchId })`.
2. For each item: `stageItem(item)` → `seedActState(item.id, actSeed)` → optional `stageSampleData` / top-level `setCatalogMeta`.
3. `await builder.publish()` and return its result as structured content.

**payTo resolution.** Before staging, each payment entry's `payTo` is resolved to the seller's
`RevenueSplitter` clone via `src/splitter.ts` (`resolvePayTo`). With `SPLITTER_FACTORY_ADDRESS` +
`SELLER_ADDRESS` set, `payTo` may be omitted and is filled in; a supplied `payTo` that is not the
seller's clone is a **hard error**, not a warning — publishing it would silently create an untaxed
listing that earns the seller no Proof-of-Purchase, and the mistake would only surface much later
at purchase time. Without the splitter configured, `payTo` must be supplied explicitly (the
pre-splitter behaviour).

### `ensure_split_contract`

Resolves the seller's `RevenueSplitter` clone — the address that belongs in `payment[].payTo`.

**Args** (`src/tools/ensure_split_contract/models.ts`):

```typescript
export interface EnsureSplitContractArgs {
  seller?: string; // defaults to SELLER_ADDRESS
  deploy?: boolean; // default false — predict only, no transaction
}
```

**Return:** `{ splitter, seller, factory, deployed, txHash?, treasury?, taxBps? }`.

Read-only by default. The clone address is CREATE2-deterministic, so it can be published before
deployment — an x402 (ERC-3009) settlement credits the address whether or not code lives there.
Deployment (`deploy: true`, requires `PRIVATE_KEY`) is only needed before the first `distribute()`.

### `get_agent`

Resolves an ERC-8004 agent id to its on-chain Agent Card (read-only — RPC + Swarm fetch, no signer). Optionally enumerates the agent's catalog.

**Args** (`src/tools/get_agent/models.ts`):

```typescript
export interface GetAgentArgs {
  agentId: string; // ERC-8004 NFT token id
  includeCatalog?: boolean; // also resolve the "swarm-ai-catalog" feed and list items
}
```

**Flow:** `identity.getAgentURI(agentId)` → `downloadAgentCard(uri)`. When `includeCatalog` is true, reads the catalog feed owner from the Agent Card's `"swarm-ai-catalog"` service `endpoint`, resolves the catalog feed → Mantaray root, and enumerates `/items/{itemId}/item.jsonld` leaves (mirrors the §13.2 reader list flow using `@solarpunk/swarm-catalog` primitives).

**Return:** `{ agentId, agentURI, agentCard, catalog? }` where `catalog` is `{ owner, name?, description?, license?, items[] }`, or `null` (with `catalogNote`) if the card has no catalog service, or `{ owner, items: [], error }` if the feed is unreadable. `registrations[].agentId` (bigint) is stringified in the response.

## Caller responsibilities (NOT done by this tool)

Two §12.2 steps are the caller's, exactly as in `swarm-catalog`:

1. **Upload the priced content to Swarm first** (ACT-protected), then pass its reference as both `item.id` and `item.storage.reference`.
2. **ACT-wrap the content** (e.g. via `swarm-mcp`'s `upload_data` with `act: true`, optionally combined with `create_grantees` / `patch_grantees`), capture the initial `actHistoryRef` + `granteeRef`, and pass them in `actSeed`.

The tool throws if any priced item is missing its `actSeed` (the builder enforces this).

## Load-bearing invariants (do not violate)

- **All priced content is ACT-protected** — no per-item flag.
- **`item.id` MUST equal `item.storage.reference`** (64-char hex content reference).
- **Two separate feed signers**: catalog feed signer (cold, `BEE_FEED_PK`) ≠ per-item state feed signer (hot, `ITEM_STATE_FEED_PK`). The builder throws at construction if they match.
- **Catalog feed payload is a bare 64-char hex root** — not JSON. The builder handles this; do not wrap it.
- **ACT history reference lives in `CatalogItemState`** (written to the state feed), never in `item.jsonld`.

## Environment variables

| Variable                   | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `BEE_API_URL`              | Bee node endpoint, default `http://localhost:1633`                                |
| `BEE_FEED_PK`              | Catalog feed signer private key (cold key)                                        |
| `ITEM_STATE_FEED_PK`       | Per-item state feed signer private key (hot key) — MUST differ from `BEE_FEED_PK` |
| `POSTAGE_BATCH_ID`         | Postage stamp batch ID for uploads                                                |
| `RPC_URL`                  | EVM RPC endpoint for `get_agent` reads (default `https://sepolia.base.org`)       |
| `ERC8004_CHAIN`            | Chain key for the ERC-8004 client (default `base-sepolia`)                        |
| `SPLITTER_FACTORY_ADDRESS` | `SplitterFactory` address used to resolve a seller's splitter clone               |
| `SELLER_ADDRESS`           | Seller whose clone becomes `payment[].payTo` in `build_catalog`                   |

## Package skeleton (match `swarm-mcp`)

Mirror swarm-mcp's layout so an agent familiar with one server understands this one:

```
src/
  index.ts            — #!/usr/bin/env node entrypoint: new SwarmMarketMCPServer()
                        + StdioServerTransport, then server.connect(transport)
  mcp-service.ts      — SwarmMarketMCPServer class wrapping McpServer; constructs the
                        Bee client, declares capabilities, and dispatches CallToolRequest
                        via a switch on request.params.name
  config.ts           — default-exported config object reading env (BEE_API_URL,
                        BEE_FEED_PK, ITEM_STATE_FEED_PK, POSTAGE_BATCH_ID)
  constants.ts        — package constants / defaults
  schemas/
    index.ts          — barrel re-exporting tool schemas
    tools.ts          — exported tools array (JSON-Schema; see dual-schema note below)
    zod-schemas.ts    — Zod schemas for runtime arg parsing
  tools/
    build_catalog/
      index.ts        — buildCatalog(args, bee) tool fn
      models.ts       — BuildCatalogArgs / BuildCatalogItem types
  utils/
    index.ts          — getResponseWithStructuredContent, getToolErrorResponse, ToolResponse
```

`build_catalog` is a plain **sync tool** — it does not need swarm-mcp's `tasks/`
(Experimental Tasks API) or `prompts/`. Omit them unless a long-running variant is needed.

## Dual schema per tool (important)

Each tool is described **twice**, exactly as in swarm-mcp — keep both in sync:

1. **JSON-Schema** entry in the exported tools array in `src/schemas/tools.ts`
   (`name`, `title`, `description`, `inputSchema`, `outputSchema`,
   `execution: { taskSupport: "forbidden" }`). This is what the server advertises to
   MCP clients in `ListTools`.
2. **Zod schema** in `src/schemas/zod-schemas.ts` — used inside the `CallTool` handler to
   `parse()` and validate incoming args before calling the tool fn.

## Implementation conventions

- One tool per directory: `src/tools/build_catalog/{index.ts,models.ts}`.
- Tool fn signature: `buildCatalog(args: BuildCatalogArgs, bee: Bee): Promise<ToolResponse>`.
- Dispatch in the `CallToolRequest` switch in `src/mcp-service.ts`:
  `zodSchema.parse(args)` → call `buildCatalog(...)`.
- Success → `getResponseWithStructuredContent(...)`; failures → `getToolErrorResponse(...)`.
  Let builder validation errors surface as readable messages.

## Dependencies

```json
{
  "@solarpunk/swarm-catalog": "workspace:*",
  "@ethersphere/bee-js": "12.0.0",
  "@modelcontextprotocol/sdk": "*"
}
```

Import all catalog types (`CatalogItem`, `CatalogItemState`, `SwarmCatalogBuilder`, etc.) from `@solarpunk/swarm-catalog`. Do not redefine them here.
