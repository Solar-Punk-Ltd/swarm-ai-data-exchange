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
`RevenueSplitter` clone via `src/splitter.ts` (`resolvePayTo`), read from the factory's
`splitterOf` mapping. With `SPLITTER_FACTORY_ADDRESS` + `AGENT_PAYMENT_ADDRESS` set, `payTo` may be
omitted and is filled in. Two **hard errors**, not warnings:

- the seller has no clone yet → run `register_agent` first. There is no address to publish;
  clone addresses are ordinary CREATE addresses and cannot be derived off-chain.
- a supplied `payTo` is not the seller's clone → publishing it would silently create an untaxed
  listing that earns the seller no Proof-of-Purchase, and the mistake would only surface much
  later at purchase time.

`build_catalog` never sends a transaction. Without the splitter configured, `payTo` must be
supplied explicitly (the pre-splitter behaviour).

### `register_agent`

Idempotent, convergent seller onboarding. Replaces the former `create_agent` and
`create_split_contract`. **Safe to call on every agent startup** — it converges on the correct
state rather than creating anything unconditionally, and costs only reads once the agent is
registered.

**Args** (`src/tools/register_agent/models.ts`): `name` and `description` are required; the rest
are `image`, `version`, `x402`, `capabilities`, `catalogFeedOwner`, `postageBatchId`, `seller`,
`refreshCard`, `fromBlock`, `dryRun`, `skipSplitter`.

**Return:** `{ feedOwner, signer, chain, dryRun, identity, splitter, link, warnings, message }`.

Three steps with deliberately different failure semantics, which is why each is reported
separately rather than collapsed into one success flag:

| step       | semantics                                                                     | statuses                                                                   |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `identity` | **fatal** — without an agentId there is nothing to sell under                 | `existing` / `refreshed` / `repaired` / `minted` / `incomplete` / `failed` |
| `splitter` | reported; `unconfigured` is legitimate for identity-only deployments          | `existing` / `deployed` / `unconfigured` / `skipped` / `failed`            |
| `link`     | **never fatal** — a discovery index, and an unattributed agent can still sell | `linked` / `already-linked` / `repointed` / `skipped` / `failed`           |

With `dryRun: true` every write is suppressed and the statuses come back as `would-mint`,
`would-repair`, `would-refresh`, `would-deploy`, `would-link`. Reads still run, so a dry run
reports the _real_ current state — this is the intended way to exercise the decision path
without spending gas.

**Discovery is card-first, and that is load-bearing.** `findAgentsWithMetadata` defaults to
scanning the last `RECENT_BLOCK_COUNT` (550_000) blocks — about 13 days on Base Sepolia. A
convergent tool that mints whenever discovery comes up empty would therefore mint a duplicate NFT
for any agent older than that. So the primary lookup is the Agent Card feed itself, whose URL is
fully determined by `BEE_FEED_PK` (constant topic, owner derived from the key): no chain read, no
window. The event scan is only a fallback for the one case the card cannot answer — the repair
state below. Pass `fromBlock` to widen it.

**Verification, and why a missing back-reference means repair rather than reject.** Three checks:
`ownerOf(agentId)` equals the `PRIVATE_KEY` signer; the tokenURI resolves to a `/feeds/<owner>/`
URL owned by `BEE_FEED_PK`; and the card names the agentId in `registrations[]`. The first two
together _prove_ the agent is ours. Given them, a failing third check is not a spoof — it is our
own card, stale, which is exactly what a mint leaves behind when the post-mint card write fails.
Treating that as a rejection would mint a duplicate on the next call, so it is classified
`repairable` and the card is rewritten instead. An agent that matches the feed but is owned by
someone else is an **error, never a mint** — a second NFT for one feed is unrecoverable.

**Partial failure never loses the agentId.** Once the mint lands, no later step may return an
error response: a text-only error would discard the token id the caller just paid for. A failed
post-mint card write yields `identity.status: "incomplete"` with `agentId` populated and an
explanatory `warnings[]` entry; the next call repairs it.

**Discovery failure suppresses the mint.** "Found nothing" and "could not look" are distinguished.
A transient RPC or Swarm error returns an error rather than an NFT.

### `get_split_contract`

Reads the seller's clone from the factory's `splitterOf` mapping. Pure RPC — no signer, no gas.

**Args** (`src/tools/get_split_contract/models.ts`):

```typescript
export interface GetSplitContractArgs {
  seller?: string; // defaults to AGENT_PAYMENT_ADDRESS
}
```

**Return:** `{ splitter, seller, factory, deployed, treasury?, taxBps?, note? }`.

Returns `splitter: null` / `deployed: false` when the seller has no clone. It must never return a
speculative address: the clone address cannot be derived off-chain, and a `payTo` nobody can
collect from is worse than reporting nothing.

### `link_split_contract`

Binds an ERC-8004 agent to its `RevenueSplitter` clone by writing the clone address into the
Identity Registry under the `agent_splitter` metadata key (`AGENT_SPLITTER` in
`@solarpunk/erc8004-adapter`).

**Args** (`src/tools/link_split_contract/models.ts`):

```typescript
export interface LinkSplitContractArgs {
  agentId: string; // ERC-8004 NFT token id; the PRIVATE_KEY signer must own it
  splitter?: string; // defaults to the clone resolved for the seller
  seller?: string; // defaults to AGENT_PAYMENT_ADDRESS
}
```

**Return:** `{ agentId, splitter, seller?, factory?, txHash, metadataKey, alreadyLinked, note? }`.

**Why the registry and not the clone.** `SplitterFactory.createSplitter` is permissionless, so an
`agentId` passed to the factory would be an unauthenticated claim anyone could make about anyone —
the registry already gates `setMetadata` on NFT ownership. And clone terms are frozen at
`initialize` while agent NFT ownership can transfer, so a binding baked into the clone would decay
into a lie with no way to correct it. **Do not add `agentId` to the splitter contracts.**

Normal onboarding does not need this tool — `register_agent` establishes the link as part of
registration. It exists for what registration cannot cover: re-pointing an existing agent at a
different clone, e.g. after the agent NFT transfers to a new owner.

Ownership is checked with `getOwner` before sending, so a non-owner gets a readable error instead
of a bare revert. Idempotent: an agent already pointing at this splitter returns
`alreadyLinked: true` with no transaction.

Because `MetadataSet` indexes the metadata key, this write is what makes the reverse direction
(splitter → agent) a single log query for indexers and `marketplace-ui`. Consumers must still
verify — see `packages/marketplace-ui/CLAUDE.md` § Agent identity.

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
| `AGENT_PAYMENT_ADDRESS`    | Seller whose clone becomes `payment[].payTo` in `build_catalog`                   |
| `PRIVATE_KEY`              | Signs `register_agent` and `link_split_contract`; must own the agent NFT          |

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
