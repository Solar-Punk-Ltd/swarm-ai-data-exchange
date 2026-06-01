# Swarm AI Data Exchange — Catalog Architecture v1

**Status:** Draft v1 design specification
**Scope:** Comprehensive design document — supersedes prior catalog-feed JSON proposal and the earlier Mantaray schema draft
**Audience:** Implementers of publisher SDKs, marketplace gateways, consumer agents, and indexers (e.g. Bazaar)

---

## Part 1 — Introduction

### 1.1 Scope

This document specifies the on-Swarm catalog architecture, JSON-LD data model, HTTP API, and payment-bound retrieval flow for the Swarm AI Data Exchange (the **Exchange**). It defines:

- The shape of a publisher's catalog on Swarm (a Mantaray manifest reached via a Swarm feed)
- The JSON-LD vocabulary used in catalog leaves, co-typed with Croissant 1.1 and schema.org
- The per-item state feeds used at purchase time
- The HTTP API a publisher must expose to gate paid retrieval
- The `PurchaseIntent` envelope a consumer signs to authorise an x402 payment
- The publisher and reader workflows the protocol implies

What this document does **not** specify:

- The contents or schema of the **Agent Card** (governed by ERC-8004 and out-of-scope here; the Agent Card is a single file stored on a Swarm updatable feed — the same Swarm feed URI is used as the `tokenURI` across all ERC-8004 registries and chains for a given agent)
- The on-chain economic-layer mechanics of x402 (the `x402-axios` SDK, x402 Facilitator behaviour, ACT delegation primitives — those are downstream of this catalog spec)
- Indexer internals (Bazaar consumes this specification as input; how Bazaar stores or queries the indexed catalog is its own concern)

### 1.2 Operational scope

For v1, the Exchange is bound to a single operational environment:

- **Storage layer:** Swarm only. All catalog data and all priced assets live on Swarm. There is no IPFS, Arweave, S3, or HTTP fallback path in v1.
- **Payment layer:** EVM-compatible chains only. `PurchaseIntent` uses EIP-712 typed-data signing; payments use x402 with ERC-3009 (`transferWithAuthorization`) as the canonical settlement primitive. Non-EVM agent identities and non-EVM payments are explicit non-goals for v1.
- **Identity layer:** ERC-8004 agent registries on EVM chains. The catalog protocol itself is identity-agnostic; agent attribution is handled at the Agent Card layer (which sits above the catalog) and at indexer/aggregator services that wish to surface items per agent.

Implementations should treat these as hard constraints. Future versions may relax them; v1 must not paper over the constraint with stub fields.

### 1.3 Design principles

Five principles govern every detail of this specification. When two parts of this document appear to conflict, resolve toward whichever interpretation upholds these principles.

**Server-minimization.** The only required server-side component is the publisher's x402 purchase endpoint. Discovery, catalog reading, sample fetching, and state-feed reading are all expected to happen _directly against Swarm_ via the consumer's own Bee node or chosen gateway. The Exchange must remain functional when only the purchase endpoint is online; everything else degrades to direct Swarm reads.

**No synthesized server views.** Wherever a server endpoint _is_ exposed (purchase gateway, optional read gateways), it MUST NOT preprocess, transform, or aggregate Swarm data. The catalog-read gateway returns the bare Mantaray root reference; it does not "render" the catalog. State-feed reads are pass-throughs. This keeps the canonical truth on Swarm and prevents servers from drifting into a centralized cache that consumers depend on.

**ENS over DNS for protocol identifiers.** Protocol-level namespaces (JSON-LD `@context`, `swarm-cat:` vocabulary IRI) resolve through ENS, not DNS. The contenthash record points to a Swarm reference holding the canonical document. Any ENS gateway (`eth.limo`, `eth.link`, others) can serve the document; none is privileged.

**Schema.org first, extend only when necessary.** All asset descriptions use schema.org terms where schema.org has a term (`encodingFormat`, `width`, `height`, `duration`, `contentSize`, `inLanguage`, `wordCount`, `bitrate`, etc.). The `swarm-cat:` vocabulary defines only terms schema.org does not cover (e.g. `colorSpace`, `fps`, `codec`, `hasAudio`, `channels`, `sampleRate`, `sourceOffsetSeconds`, ML-model-specific descriptors). Croissant 1.1 is used for tabular/structured datasets via JSON-LD co-typing.

**Atomic catalog roots.** A catalog state at any moment is identified by a single Mantaray root reference (64-char hex). Adding, updating, or removing items publishes a new root; the feed's latest update points at it. Consumers always read a consistent snapshot, never a partial mutation.

### 1.4 Conventions

- "**MUST / SHOULD / MAY**" are used per RFC 2119.
- "**Reference**" without qualification means a 64-char hex Swarm content-address (the result of uploading data to a Bee node).
- "**Feed**" means a Swarm SOC (single-owner chunk) feed: an owner-signed mutable pointer at a deterministic location keyed by `(owner, topic)`.
- "**Manifest**" or "**Mantaray manifest**" means a Swarm Mantaray trie. "**Manifest root**" is its top-level reference.
- "**ACT**" means Access Control Trie: Swarm's per-content access control overlay that grants decryption rights to specific public keys.
- "**Catalog item**" means one priced AI asset published by an agent. "**Catalog item state**" is the per-purchase mutable record for that item (held in its own state feed).
- "**Publisher**" is the actor producing and listing items. "**Consumer**" is the actor browsing and buying.
- JSON examples use 2-space indentation. Wire JSON SHOULD be UTF-8 without BOM; whitespace is not significant.
- All timestamps in wire payloads are ISO 8601 UTC unless explicitly stated as Unix-seconds (which is true only inside `PurchaseIntent.validBefore` / `validAfter` to match ERC-3009 semantics).

---

## Part 2 — Glossary

| Term               | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ACT**            | Access Control Trie. A Swarm overlay that controls who can decrypt encrypted Swarm content. Grants are issued per consumer public key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ACT delegation** | Delegating the right to _issue_ ACT grants to another actor. A publisher may delegate grant-issuance authority to a trusted service (e.g. a purchase server, a future automated state-feed operator), allowing that actor to extend decryption access to ACT-protected content on the publisher's behalf without the publisher's direct involvement in each transaction. Distinct from being a grantee.                                                                                                                                                                                                                                                   |
| **ACT grantee**    | A public key that has been issued decryption rights for ACT-encrypted content. In this protocol the grantee is the consumer's Bee-node key — separate from the wallet that pays — and it is named explicitly in the `PurchaseIntent` so the publisher can issue the grant to the right key at purchase time.                                                                                                                                                                                                                                                                                                                                              |
| **Agent Card**     | A single Agent Registration File stored on a Swarm updatable feed. The Swarm feed address is used as the `tokenURI` (`agentURI`) on every ERC-8004 registry entry — across all chains and all thematic registries — for a given logical agent. All registrations are enumerated inside the Agent Card's `registrations[]` field per the ERC-8004 standard, making it the single source of truth for cross-chain and cross-registry agent identity. The Agent Card is also the discovery entry point for this catalog protocol: it publishes the catalog feed owner address in its `services` array. Schema is governed by ERC-8004 and out of scope here. |
| **Bazaar**         | The discovery/indexing layer that walks publisher catalogs and surfaces them in aggregated views. Consumes this spec; does not produce it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **bee-js**         | The reference JavaScript client for a Bee node, used by publishers to upload, build manifests, and sign feed updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **CAIP-2**         | Chain Agnostic Improvement Proposal 2 — string format identifying an EVM chain (e.g. `eip155:1` for Ethereum mainnet, `eip155:8453` for Base).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Croissant 1.1**  | The MLCommons JSON-LD vocabulary for ML datasets. Provides `cr:Dataset`, `cr:RecordSet`, `cr:Field`, etc. Used as a co-type on catalog leaves whose content is a structured dataset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **EIP-712**        | EVM standard for typed structured data signing. Used here to sign `PurchaseIntent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **ERC-3009**       | EVM standard for `transferWithAuthorization`: gasless, authorization-based stablecoin transfer. The canonical settlement primitive paired with x402.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **ERC-8004**       | EVM standard for on-chain agent identity registries. An agent is identified by a contract address (the registry) and a token-like id within it. Multiple thematic registries may exist on a chain.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **JSON-LD**        | JSON for Linked Data. The serialization used for catalog leaves. Consumers MAY treat it as plain JSON; agents and indexers MAY treat it as RDF.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Mantaray**       | Swarm's content-addressed trie manifest. Maps path strings to references plus inline metadata. Used here as the catalog's authoritative on-Swarm structure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Postage stamp**  | A Swarm storage prepaid receipt. Required to upload chunks; effectively the rent on Swarm. Stamp lifecycle matters because catalog content (including samples) is only retrievable while its underlying stamps remain solvent.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **PurchaseIntent** | The EIP-712-signed envelope a consumer presents to the publisher's purchase endpoint, binding payment authorization to a specific Bee-node public key that will become the ACT grantee for the purchased content.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **schema.org**     | The de-facto cross-web vocabulary for structured content. Provides `sc:ImageObject`, `sc:VideoObject`, `sc:AudioObject`, `sc:Dataset`, `sc:MediaObject`, and property terms like `encodingFormat`, `width`, `contentSize`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **SOC feed**       | Single-Owner Chunk feed. A Swarm primitive: an EOA owner signs an update chunk at a `(owner, topic, index)` location, producing a mutable pointer with cryptographic provenance. Used here for both the catalog feed and per-item state feeds.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **x402**           | An HTTP-native micropayment protocol: a server replies 402 with payment requirements, the client pays out-of-band (typically via ERC-3009 on an EVM chain), and retries with proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## Part 3 — Architecture Overview

### 3.1 Three-layer model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Agent Card (out of scope; ERC-8004 governed)      │
│  Single file on a Swarm updatable feed                      │
│  → tokenURI on every ERC-8004 registry points to it         │
│  → registrations[] enumerates all on-chain registrations    │
│  → services[] entry "swarm-ai-catalog" publishes the        │
│    catalog feed owner address                               │
└─────────────────────────────────────────────────────────────┘
                          │
                          │  one agent identity may operate
                          │  one or more catalog feeds
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Catalog feed (Swarm SOC feed)                     │
│  feed payload = bare Mantaray root reference (64-char hex)  │
│  → resolves to the current catalog Mantaray                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          │  Mantaray root = atomic snapshot
                          │  of N items
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Catalog Mantaray (Swarm content-addressed)        │
│  /catalog.jsonld          ← collection-level metadata       │
│  /items/{itemId}/         ← one directory per item          │
│      item.jsonld          ← per-item JSON-LD leaf           │
│      sample/              ← preview/sample content          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │  orthogonal to the catalog Mantaray,
                          │  each item has its own state feed:
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2b: Per-item state feed (Swarm SOC feed)             │
│  one feed per published item                                │
│  feed payload = CatalogItemState JSON reference             │
│  → mutated at purchase time by the publisher's server       │
└─────────────────────────────────────────────────────────────┘
```

A consumer needs only a reference to the Agent Card on Swarm to bootstrap discovery: the Card publishes the catalog feed owner address in its services array. Everything else follows from Swarm reads.

### 3.2 Server minimization

The only required server component is the publisher's **x402 purchase endpoint**. It must:

- Issue 402 challenges with `accepts` describing the available payment methods.
- Verify `PurchaseIntent` signatures, run the x402 verification handshake with a Facilitator, settle the payment, and on success grant ACT access to the buyer's Bee-node public key, then write the item's state feed.

All of the following are deliberately _not_ required server components:

- A catalog-rendering API. Consumers read the catalog Mantaray directly from Swarm.
- A sample-fetching API. Sample data is in the Mantaray; consumers fetch its references via their Bee node.
- A state-feed-reading API. State feeds are SOC feeds on Swarm; publishers write them and consumers MAY read them directly for verification purposes.

Implementers MAY expose optional pass-through gateway endpoints (`GET /v1/catalog`, `GET /v1/state/{itemId}`) for non-Bee web clients. When they exist, those endpoints MUST be pure pass-throughs: the catalog gateway returns the bare Mantaray root reference and nothing else; the state gateway returns the raw latest state feed payload. No server-side join, no synthesized listing JSON, no projection.

The rationale is operational and political: minimizing server surface keeps the canonical truth on Swarm, makes the publisher's infrastructure replaceable without breaking discovery, and prevents the gateway from drifting into a de-facto centralized cache that consumers come to depend on.

### 3.3 Feed roles

Two distinct feeds with different mutation patterns:

| Feed                    | Purpose                                                                                                                                                                                                                                       | Owner key                                     | Write trigger                                      | Write frequency         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ----------------------- |
| **Catalog feed**        | Points at the current catalog Mantaray root. Atomic snapshot of all listings.                                                                                                                                                                 | Publisher's catalog signer                    | Publisher mutates catalog (add/update/remove item) | Low (publishing events) |
| **Per-item state feed** | Holds the publisher's ACT-state record for one item: current ACT history reference, plus operational bookkeeping (purchase counter, lifecycle, version). Written by the publisher after every grant; read by consumers only for verification. | Publisher's per-item signer (MAY be same key) | Successful purchase or admin action                | High (every purchase)   |

The two-feed split exists because the per-item ACT-state record mutates on every successful grant and is operationally owned by the purchase service, whereas catalog edits are deliberate, low-frequency, and warrant a separately-controlled signer. See §4.3 for the full rationale.

### 3.4 Discovery path

```
Agent Card on Swarm
  → read services entry "swarm-ai-catalog" → catalog feed owner address
  → compute topic = keccak256("swarm-ai-catalog.v1")
  → read catalog feed (owner, topic) → Mantaray root reference
  → fetch Mantaray → list /items/* paths
  → for each path: read inline metadata (cheap) or fetch item.jsonld (full)
  → for items the user opens: fetch /items/{itemId}/sample/*
  → for items the user buys: POST to publisher's purchase endpoint
```

A consumer reaches the Agent Card by any standard ERC-8004 means: resolving the `tokenURI` of any of the agent's on-chain registrations, following a direct Swarm feed reference shared out-of-band, or consulting an indexer. From this catalog protocol's point of view, the Agent Card is simply _given_; how it was found is upstream.

No step in this path requires a publisher server other than the final purchase step. Bazaar and similar indexers MAY replicate this walk to build aggregated views, but the path is consumer-executable.

---

## Part 4 — Feeds

### 4.1 Catalog feed

The catalog feed is a Swarm SOC feed whose payload is the **bare Mantaray root reference of the catalog** — a 64-character lowercase hex string, 32 bytes raw. It is NOT a JSON object containing the reference; it is the reference. This minimizes payload size and removes any opportunity for server-side ambiguity about what "the current catalog" is.

```
catalog feed payload = "a3f2...c8d1" (64 hex chars, no quotes, no envelope)
```

**Owner.** An EVM EOA controlled by the publisher. The catalog feed owner address MUST be published in the Agent Card's `services` array as an entry with name `"swarm-ai-catalog"`. This is the authoritative source for the owner address; it is chain-agnostic and registry-agnostic, consistent with the Agent Card being the single source of truth for the agent's identity across all registrations.

Publishers MAY use a delegated signer for operational separation from the key that controls on-chain registry entries.

**Topic.** The catalog feed topic is a **fixed protocol constant**, derived from the protocol namespace string alone — with no reference to any chain, registry contract, or agent token id:

```
topic = keccak256("swarm-ai-catalog.v1")
```

Because a Swarm SOC feed is uniquely identified by `(owner, topic)`, and the owner is already publisher-specific, encoding identity information into the topic would be redundant and would couple the catalog to a particular on-chain registration. A constant topic keeps the catalog a pure Swarm-layer construct: it is independent of which chain or registry the agent happens to be registered on, and it remains stable across re-registrations, chain migrations, or the addition of new registry entries. Consumers discover the owner from the single Agent Card; the catalog itself carries no on-chain identifiers.

This convention is documented in the protocol context document (see §7.3).

**Reading.** A consumer with a Bee node resolves `(owner, topic)` → latest update → 64-byte payload → first 32 bytes are the Mantaray root reference. The rest of the discovery path proceeds directly against Swarm.

**Updating.** Whenever the publisher changes the catalog (any item add/update/remove), they upload a new Mantaray, then push a feed update with the new root reference. The old Mantaray remains retrievable by reference as long as its postage stamps remain solvent; consumers caching an older root see a consistent old snapshot.

### 4.2 Per-item state feed

Each catalog item has its own SOC feed carrying a reference to the current `CatalogItemState` JSON (see §6.4). The state record's **sole role** is to track the publisher's ACT-state for the item — the current ACT history reference and the current grantee-list reference, both of which advance with every grant — plus a small amount of operational metadata (lifecycle, version). The feed is written by the publisher's purchase service after every successful grant.

**Consumer access is verification-only.** Consumers SHOULD NOT treat the state feed as a subscription channel for content updates, popularity signals, or change notifications. Acceptable consumer reads are: (a) retrieving the current ACT history reference when a cached one is no longer sufficient to fetch granted content, and (b) retrieving the current grantee-list reference to verify a publisher's lifecycle claim or to derive a cryptographically grounded purchase count from the grantee chunks (see §14.4). Discovery, browsing, and lifecycle awareness happen through the catalog Mantaray, not the state feed.

**Owner.** The publisher's per-item signer. MAY be the same key as the catalog feed owner. Operationally, splitting keys is recommended so a compromised purchase server cannot rewrite the catalog itself.

**Topic.** The state-feed topic for item `itemId` (where `itemId` is the Mantaray path segment under `/items/`, see §5.3) is:

```
topic = keccak256("swarm-ai-catalog-state.v1" || catalogFeedOwner || itemId)
```

Where `catalogFeedOwner` is the 20-byte EOA address of the catalog feed's signer. This binds the state feed to the catalog that listed the item, so a stolen state feed cannot be reattached elsewhere.

**Payload.** A 64-character hex Swarm reference to a JSON document conforming to `CatalogItemState` (§6.4).

### 4.3 Two-feed rationale

A single feed combining catalog snapshot and per-item state would couple publishing-edit cadence to purchase cadence. Two consequences make that unacceptable:

1. **Contention.** Purchases land at unpredictable times and rates; catalog edits are deliberate publisher actions. Forcing them through one signer slot creates ordering races: a purchase write that arrives mid-edit either races the edit or stalls behind it.
2. **Operational key separation.** Per-item ACT-state writes happen on every grant, driven by the purchase service's hot key. Catalog edits are deliberate publisher actions worthy of a separately-controlled (often colder) signer. Coupling them would force one key to serve both jobs — either the hot key signs catalog edits (security loss) or the cold key participates in every purchase (operational loss). Two feeds let two keys do two jobs.

The two-feed split is therefore not an optimization but a correctness property. Implementers MUST NOT collapse them into one feed without a separate proposal.

### 4.4 Ownership and ACT delegation

The catalog and state-feed signers are the publisher's keys. They are NOT used for ACT delegation: ACT grants are issued to the **consumer's Bee-node public key**, which is presented inside `PurchaseIntent` (see §11.2). The split between the consumer's payment wallet and their Bee-node key is essential — the wallet signs payment, the Bee key receives the decryption grant.

Publishers SHOULD use distinct signer keys for:

- Catalog feed updates (low-frequency, high-value)
- State feed updates per item or per item group (high-frequency, lower-value)
- ACT grant issuance (operational hot key)

The protocol does not enforce this split; it is operational hygiene.

### 4.5 Update mechanics

A catalog edit is always:

1. Compute the new catalog Mantaray (incremental: copy-on-write the affected branches).
2. Upload the new Mantaray to Swarm under a publisher-controlled postage stamp.
3. Push a feed update on the catalog feed with the new root reference.
4. (Optional) Push state-feed updates for any items whose state schema or lifecycle field changed.

A state-feed edit is always:

1. Compute the new `CatalogItemState` JSON.
2. Upload to Swarm.
3. Push a feed update on that item's state feed with the new reference.

Neither operation requires the publisher's HTTP service. A publisher who can run a Bee node and a feed signer can keep the catalog alive even if their purchase endpoint is down — sales would pause but discovery would continue.

---

## Part 5 — Catalog Mantaray Schema

### 5.1 Top-level layout

The catalog Mantaray has this path structure:

```
/                              (Mantaray root)
├── catalog.jsonld             (collection-level JSON-LD)
├── items/
│   ├── {itemId}/              (one directory per catalog item)
│   │   ├── item.jsonld        (per-item JSON-LD leaf)
│   │   └── sample/            (optional preview content; see §9)
│   │       └── ...
│   ├── {itemId}/
│   │   └── ...
│   └── ...
└── (reserved for future extensions; consumers MUST ignore unknown top-level paths)
```

Path conventions:

- All path segments are lowercase URL-safe (`[a-z0-9-_]`).
- `{itemId}` is the **Swarm reference of the item's primary content blob**, in lowercase hex. Using the content reference as the directory key makes item ids content-addressed, deterministic across publishers, and stable across catalog edits as long as the underlying asset doesn't change.
- Trailing slashes are not part of the path key in Mantaray.

### 5.2 /catalog.jsonld

This is the collection-level JSON-LD document. It describes the catalog as a whole, not individual items. Suggested shape:

```json
{
  "@context": "https://swarm-ai-catalog.eth/v1",
  "@type": ["sc:DataCatalog", "swarm-cat:Catalog"],
  "name": "Acme AI Vision Datasets",
  "description": "Curated image and video training data from the Acme labelling pipeline.",
  "license": "https://example.com/licenses/acme-data-v1",
  "dateModified": "2026-05-18T12:00:00Z",
  "swarm-cat:itemCount": 127,
  "swarm-cat:protocolVersion": "1.0"
}
```

The catalog document carries no agent-identity fields. The catalog feed owner (an EVM EOA) is the de-facto publisher; cross-linking from that EOA to an ERC-8004 agent identity is performed via the Agent Card, which lists the catalog feed owner address in its services entry (see §4.1). Indexers and aggregators that want to attribute catalogs or items to specific agents can do so by walking from Agent Cards to catalog feed owners; this catalog protocol does not duplicate that linkage at the catalog level.

### 5.3 Per-item directory

Each catalog item lives under `/items/{itemId}/`. The directory contains at minimum:

| Path          | Required | Description                                       |
| ------------- | -------- | ------------------------------------------------- |
| `item.jsonld` | Yes      | The per-item JSON-LD leaf (see Part 7 and Part 8) |
| `sample/...`  | No       | Optional preview/sample content (see Part 9)      |

Consumers locate items by enumerating Mantaray forks under `/items/`. The Mantaray's fork metadata MAY carry inline summary fields (see §5.5), allowing list-view rendering without fetching each `item.jsonld`.

### 5.4 /sample/

The `sample/` subdirectory contains the publisher's preview content for the item. Its layout is content-dependent — see §9 for the conventions per content type. The layout is not a Mantaray reserved path; it is a convention this specification defines for protocol consumers.

### 5.5 Inline fork metadata

Mantaray supports inline metadata per fork. To enable cheap list-view rendering, publishers SHOULD attach the following metadata on the fork that points at `/items/{itemId}/`:

| Key                        | Type   | Description                                                              |
| -------------------------- | ------ | ------------------------------------------------------------------------ |
| `swarm-cat:name`           | string | Human-readable item name (matches `item.jsonld` `name`)                  |
| `swarm-cat:contentType`    | string | One of `image`, `video`, `audio`, `text`, `dataset`, `document`, `bytes` |
| `swarm-cat:encodingFormat` | string | Primary MIME type of the priced asset                                    |
| `swarm-cat:priceMinor`     | string | Smallest-unit price (e.g. `"1000000"` for 1 USDC)                        |
| `swarm-cat:priceAsset`     | string | CAIP-19 asset identifier (e.g. `eip155:8453/erc20:0x...`)                |
| `swarm-cat:tags`           | string | Comma-separated tag list, lowercase                                      |
| `swarm-cat:dateAdded`      | string | ISO 8601 timestamp the item was first listed                             |
| `swarm-cat:version`        | string | Item content version, semantic ver. if used                              |
| `swarm-cat:lifecycle`      | string | One of `active`, `deprecated`, `retired`                                 |

These are advisory caches. The authoritative values live in `item.jsonld`. Indexers SHOULD trust inline metadata for list views and refetch `item.jsonld` only when the user opens the item or when staleness is suspected.

A consumer noticing a mismatch between inline metadata and `item.jsonld` MUST prefer `item.jsonld`.

---

## Part 6 — Data Model

This part defines the abstract data model used throughout the protocol. The wire format is JSON-LD (for catalog leaves) or plain JSON (for state feeds, purchase responses, and errors). Concrete TypeScript types appear in Appendix A.

### 6.1 SwarmStorage

`SwarmStorage` describes where on Swarm the priced asset lives.

| Field         | Type                 | Required | Description                                                                                                  |
| ------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `reference`   | string (64-char hex) | Yes      | The Swarm reference to the encrypted, ACT-protected content                                                  |
| `encryption`  | string               | No       | Encryption mode identifier; reserved for future use, MUST be omitted in v1                                   |
| `contentSize` | integer              | No       | Size of the asset in bytes (also appears in the JSON-LD content descriptor; duplicated here for convenience) |

In v1, **all priced content is ACT-protected** — there is no open-access path for priced items. The protocol therefore does not carry a per-item "is ACT enabled" flag. The current ACT history reference lives in `CatalogItemState` (§6.4), not here, because it advances with every grant; embedding it in the catalog would either go stale immediately or force a catalog edit per purchase. The `reference` field above is the encrypted-content reference; consumers obtain the current `actHistoryRef` either from their `ActGrantResult` (at purchase time) or from the state feed (for verification later).

### 6.2 PaymentRequirements

`PaymentRequirements` describes the x402-compatible payment terms for the item. It mirrors the x402 `accepts[].extra` shape so a publisher's 402 response can quote directly from the catalog without translation.

| Field         | Type                            | Required | Description                                                                        |
| ------------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `scheme`      | string                          | Yes      | Payment scheme identifier. v1 supports `exact` (fixed price, ERC-3009 settlement). |
| `chainId`     | string (CAIP-2)                 | Yes      | EVM chain on which payment is settled                                              |
| `asset`       | string (CAIP-19)                | Yes      | Payment asset, e.g. `eip155:8453/erc20:0x833...` (USDC on Base)                    |
| `amount`      | string (uint as decimal string) | Yes      | Price in smallest unit of `asset`                                                  |
| `payTo`       | string (0x-prefixed address)    | Yes      | Recipient of the payment                                                           |
| `facilitator` | string (URL)                    | No       | Recommended Facilitator URL for verification & settlement                          |
| `description` | string                          | No       | Human-readable description of what's being paid for                                |

Multiple `PaymentRequirements` MAY be attached to one item (e.g. same price on multiple chains, or fixed-price + subscription tiers). Implementations of v1 SHOULD support multiple but MAY ship single-requirement first.

### 6.3 CatalogItem

`CatalogItem` is the conceptual model for one listing. Its on-wire representation is the JSON-LD `item.jsonld` document — see Part 7 for the JSON-LD shape, this section names the fields.

| Field          | Type                                          | Required | Description                                                                               |
| -------------- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `id`           | string                                        | Yes      | The `{itemId}` path segment; equals the priced asset's Swarm reference                    |
| `name`         | string                                        | Yes      | Human-readable item name                                                                  |
| `description`  | string                                        | Yes      | Markdown-formatted long description                                                       |
| `content`      | `ContentSpec` (discriminated by content type) | Yes      | The schema.org/Croissant content descriptor                                               |
| `storage`      | `SwarmStorage`                                | Yes      | Where the asset is on Swarm                                                               |
| `payment`      | `PaymentRequirements[]`                       | Yes      | Payment terms (≥ 1)                                                                       |
| `sample`       | `SampleSpec`                                  | No       | Description of the `sample/` subdirectory contents                                        |
| `license`      | string (URL or SPDX id)                       | No       | License under which the asset is offered; Recommended for non-trivial value assets        |
| `tags`         | string[]                                      | No       | Lowercase tags. MUST be unique; SHOULD be drawn from a controlled vocabulary if available |
| `version`      | string                                        | No       | Semantic ver. or publisher-defined version string                                         |
| `lifecycle`    | `"active" \| "deprecated" \| "retired"`       | Yes      | Listing state                                                                             |
| `dateAdded`    | string (ISO 8601)                             | Yes      | When the item was first listed                                                            |
| `dateModified` | string (ISO 8601)                             | Yes      | Last edit timestamp                                                                       |

**Tag rules.** Tags are advisory; consumers MAY filter by them. Publishers SHOULD use a controlled vocabulary (e.g. their own taxonomy, or a Bazaar-provided one). The protocol does not mandate a global taxonomy in v1.

**Lifecycle rules.**

- `active` — item is listed and purchasable.
- `deprecated` — item is listed for discovery but a newer version exists; publisher SHOULD point to the replacement via a `swarm-cat:supersededBy` field referencing the new item id.
- `retired` — item is not purchasable; existing purchasers still hold ACT grants and can retrieve content. Catalog SHOULD keep the entry so prior purchasers can resolve their purchases.

`ContentSpec` is a discriminated union by content type — see Part 7 and Part 8 for the variants.

### 6.4 CatalogItemState

`CatalogItemState` is the per-item mutable record held in the per-item state feed. Its sole role is to maintain the publisher's authoritative record of the item's current ACT state — the current ACT history reference and the current grantee-list reference — both of which advance with every grant.

| Field                 | Type                 | Required | Description                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `itemId`              | string               | Yes      | The item id (same as `/items/{itemId}/` path)                                                                                                                                                                                                                                       |
| `actHistoryRef`       | string (64-char hex) | Yes      | The **current** ACT history reference for this item, advancing with every grant                                                                                                                                                                                                     |
| `granteeRef`          | string (64-char hex) | Yes      | The **current** grantee-list reference for this item, advancing with every grant. Required for the next `patchGrantees` call by the publisher; also lets observers derive a cryptographically grounded purchase count by following the reference to the grantee chunks (see §14.4). |
| `lifecycle`           | string               | Yes      | Current lifecycle (may diverge from `item.jsonld` if the catalog hasn't been republished yet)                                                                                                                                                                                       |
| `version`             | string               | No       | Current version, if updated                                                                                                                                                                                                                                                         |
| `catalogRootAtUpdate` | string (64-char hex) | No       | The catalog Mantaray root at the time this state was written. Allows consumers to check that the state matches the catalog snapshot they're viewing.                                                                                                                                |
| `dateModified`        | string (ISO 8601)    | Yes      | When this state was last written                                                                                                                                                                                                                                                    |

The state feed exists exclusively for the publisher's own ACT-state management. Consumer access is restricted to verification purposes — refreshing the ACT history reference when a cached one no longer suffices, or following `granteeRef` to derive a verifiable purchase count. Consumers MUST NOT treat the state feed as a subscription source for content updates or popularity signals; for content the catalog Mantaray (`item.jsonld`) is the source of truth, and for marketplace-wide popularity the Marketplace Event Collector (or equivalent off-chain indexer) is the right layer.

**On fields deliberately omitted.** `CatalogItemState` carries no purchase counter and no recent-purchase snapshot. A self-reported counter would live on the wrong side of the access-pattern split (it is an analytics signal, not a transaction precondition) and would duplicate — without strengthening — what `granteeRef` already makes derivable. A recent-purchase snapshot would mislead consumers whose only legitimate read is to verify their own grant against a live state feed; `dateModified` plus on-chain settlement queries already cover liveness without that misuse surface. See §14.4 for the analytics-layer rationale.

### 6.5 ActGrantResult

`ActGrantResult` is the publisher's confirmation that a successful purchase has resulted in an ACT grant to the consumer's Bee-node key. It is returned in the body of the successful purchase response (see §10.3).

| Field           | Type                 | Required | Description                                                                                                                                                                                                                                         |
| --------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `itemId`        | string               | Yes      | The purchased item                                                                                                                                                                                                                                  |
| `actHistoryRef` | string (64-char hex) | Yes      | The ACT history reference the consumer presents to their Bee node. This is the value of the state feed's `actHistoryRef` immediately after this grant; consumers MAY cache it and only re-read the state feed when this cached value stops working. |
| `grantTo`       | string (hex pubkey)  | Yes      | The Bee-node public key the grant was issued to (echoes `PurchaseIntent.granteePublicKey`)                                                                                                                                                          |
| `reference`     | string (64-char hex) | Yes      | The Swarm reference of the content the consumer is now authorized to retrieve                                                                                                                                                                       |
| `txHash`        | string (0x-prefixed) | Yes      | The settlement transaction hash                                                                                                                                                                                                                     |
| `grantedAt`     | string (ISO 8601)    | Yes      | When the grant was issued                                                                                                                                                                                                                           |
| `expiresAt`     | string (ISO 8601)    | No       | Grant expiry, if the publisher revokes after a window. Omitted means permanent.                                                                                                                                                                     |

---

## Part 7 — JSON-LD Leaf Data Model

### 7.1 Mixed-type approach

Each `item.jsonld` MUST be co-typed with:

1. **`swarm-cat:CatalogItem`** — the protocol type that brings in `storage`, `payment`, `lifecycle`, `version`, `sample`, and other protocol-specific fields.
2. **A content-type-specific class.** Use the most specific applicable class:
   - Structured / tabular data → `cr:Dataset` (Croissant 1.1) **and** `sc:Dataset`
   - Images → `sc:ImageObject`
   - Video → `sc:VideoObject`
   - Audio → `sc:AudioObject`
   - Text/documents (prose, articles, code) → `sc:TextDigitalDocument` or `sc:CreativeWork`
   - Raw byte streams (model weights, opaque binary) → `sc:MediaObject`

This co-typing means the JSON-LD document is simultaneously:

- A protocol-level catalog item (`swarm-cat:CatalogItem`) that the publisher SDK and the purchase server understand.
- A schema.org-canonical asset description that generic web crawlers and search engines can index.
- (For datasets) a Croissant document that ML tooling can consume directly.

### 7.2 swarm-cat: vocabulary

The `swarm-cat:` prefix expands to the protocol namespace IRI:

```
https://swarm-ai-catalog.eth/v1#
```

The ENS name `swarm-ai-catalog.eth` is a v1 placeholder; the final registration is an open implementation item (§18). Once registered, its ENS contenthash record will point to a Swarm reference holding the canonical context document (see §7.3). The IRI itself is the stable identifier; the Swarm reference behind it is the durable, content-addressed storage location.

**Classes defined by `swarm-cat:`**

| Class                           | Description                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `swarm-cat:Catalog`             | Co-type for the collection-level `/catalog.jsonld` document; lives alongside `sc:DataCatalog` |
| `swarm-cat:CatalogItem`         | Co-type for every `item.jsonld` document                                                      |
| `swarm-cat:SwarmStorage`        | Storage descriptor referencing Swarm content + ACT info                                       |
| `swarm-cat:PaymentRequirements` | Payment terms for an item                                                                     |
| `swarm-cat:SampleSpec`          | Description of the contents of `/sample/`                                                     |

**Properties defined by `swarm-cat:`** (only those schema.org does not cover)

| Property                                                                                                                                                                            | Domain                             | Range                               | Description                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `swarm-cat:storage`                                                                                                                                                                 | `CatalogItem`                      | `SwarmStorage`                      | Where on Swarm the priced asset is                  |
| `swarm-cat:payment`                                                                                                                                                                 | `CatalogItem`                      | `PaymentRequirements[]`             | Payment terms                                       |
| `swarm-cat:sample`                                                                                                                                                                  | `CatalogItem`                      | `SampleSpec`                        | Sample/preview description                          |
| `swarm-cat:lifecycle`                                                                                                                                                               | `CatalogItem`                      | `"active"\|"deprecated"\|"retired"` | Listing state                                       |
| `swarm-cat:supersededBy`                                                                                                                                                            | `CatalogItem`                      | string (item id)                    | For deprecated items, the replacement               |
| `swarm-cat:reference`                                                                                                                                                               | `SwarmStorage`                     | string (64-char hex)                | Swarm reference                                     |
| `swarm-cat:actHistoryRef`                                                                                                                                                           | `CatalogItemState`                 | string                              | Current ACT history reference (advances per grant)  |
| `swarm-cat:granteeRef`                                                                                                                                                              | `CatalogItemState`                 | string                              | Current grantee-list reference (advances per grant) |
| `swarm-cat:scheme`                                                                                                                                                                  | `PaymentRequirements`              | string                              | x402 scheme id                                      |
| `swarm-cat:asset`                                                                                                                                                                   | `PaymentRequirements`              | string (CAIP-19)                    | Payment asset                                       |
| `swarm-cat:amount`                                                                                                                                                                  | `PaymentRequirements`              | string                              | Smallest-unit amount                                |
| `swarm-cat:payTo`                                                                                                                                                                   | `PaymentRequirements`              | string (address)                    | Recipient                                           |
| `swarm-cat:facilitator`                                                                                                                                                             | `PaymentRequirements`              | string (URL)                        | Facilitator URL                                     |
| `swarm-cat:chainId`                                                                                                                                                                 | `PaymentRequirements`              | string (CAIP-2)                     | EVM chain id                                        |
| `swarm-cat:colorSpace`                                                                                                                                                              | `sc:ImageObject`                   | string                              | Color space, e.g. `sRGB`, `Display-P3`              |
| `swarm-cat:fps`                                                                                                                                                                     | `sc:VideoObject`                   | number                              | Frame rate (frames per second)                      |
| `swarm-cat:codec`                                                                                                                                                                   | `sc:VideoObject`, `sc:AudioObject` | string                              | Codec identifier                                    |
| `swarm-cat:hasAudio`                                                                                                                                                                | `sc:VideoObject`                   | boolean                             | Whether the video contains an audio track           |
| `swarm-cat:channels`                                                                                                                                                                | `sc:AudioObject`                   | integer                             | Number of audio channels                            |
| `swarm-cat:sampleRate`                                                                                                                                                              | `sc:AudioObject`                   | integer                             | Sample rate in Hz                                   |
| `swarm-cat:sourceOffsetSeconds`                                                                                                                                                     | sample-only descriptors            | number                              | For samples derived from a slice of the source      |
| `swarm-cat:modelArchitecture`                                                                                                                                                       | `sc:MediaObject`                   | string                              | ML model architecture (e.g. `transformer`, `cnn`)   |
| `swarm-cat:parameters`                                                                                                                                                              | `sc:MediaObject`                   | integer                             | ML model parameter count                            |
| `swarm-cat:isMultiFile`                                                                                                                                                             | `cr:Dataset`                       | boolean                             | Dataset spans multiple files                        |
| `swarm-cat:protocolVersion`                                                                                                                                                         | `Catalog`                          | string                              | Catalog protocol version                            |
| `swarm-cat:itemCount`                                                                                                                                                               | `Catalog`                          | integer                             | Number of items in the catalog (advisory)           |
| `swarm-cat:name`, `swarm-cat:contentType`, `swarm-cat:encodingFormat`, `swarm-cat:priceMinor`, `swarm-cat:priceAsset`, `swarm-cat:tags`, `swarm-cat:dateAdded`, `swarm-cat:version` | inline fork metadata only          | string                              | See §5.5                                            |

**Wherever a property has a schema.org equivalent, USE the schema.org property, not a `swarm-cat:` copy.** That includes `name`, `description`, `encodingFormat`, `contentSize`, `contentUrl`, `width`, `height`, `duration`, `inLanguage`, `wordCount`, `bitrate`, `license`, `dateModified`, `dateCreated`, `version`.

### 7.3 @context document

The `@context` document is published at:

- **Canonical IRI:** `https://swarm-ai-catalog.eth/v1`
- **Backing Swarm reference:** the ENS contenthash record for `swarm-ai-catalog.eth` resolves to a Swarm reference holding this JSON document
- **Resolution paths for HTTPS-only consumers:** any ENS gateway (`swarm-ai-catalog.eth.limo`, `swarm-ai-catalog.eth.link`, etc.); none is mandated, all serve the same content
- **Resolution path for Web3-native consumers:** resolve `swarm-ai-catalog.eth` via Ethereum → contenthash → Swarm reference → fetch via any Bee node

Consumers SHOULD cache the context document locally. The JSON-LD spec explicitly treats `@context` IRIs as identifiers, not as URLs that MUST be fetched.

The context document defines short aliases for the prefixed terms. Catalog leaves can then use bare property names:

```json
{
  "@context": "https://swarm-ai-catalog.eth/v1",
  "@type": ["swarm-cat:CatalogItem", "sc:ImageObject"],
  "id": "a3f2c8...",
  "name": "Annotated street-scene corpus",
  "encodingFormat": "image/png",
  "width": 1920,
  "height": 1080,
  "contentSize": 524288,
  "storage": {
    "reference": "a3f2c8..."
  },
  "payment": [
    {
      "scheme": "exact",
      "chainId": "eip155:8453",
      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000000",
      "payTo": "0xabcd...1234"
    }
  ],
  "lifecycle": "active"
}
```

A consumer that does NOT want to do JSON-LD expansion can read this as plain JSON. A consumer that DOES expand it produces canonical RDF triples using the protocol vocabulary.

The expanded form of any term defined by the context is its full IRI:

- `storage` → `https://swarm-ai-catalog.eth/v1#storage`
- `name` → `http://schema.org/name`
- `encodingFormat` → `http://schema.org/encodingFormat`
- `recordSet` → `http://mlcommons.org/croissant#recordSet`

### 7.4 ContentSpec → JSON-LD mapping

Where the publisher SDK accepts a TypeScript `ContentSpec` (Appendix A), the on-wire JSON-LD differs only in two ways:

1. The `type` discriminator becomes a JSON-LD `@type` array combining `swarm-cat:CatalogItem` with the content class.
2. Field names are schema.org names (already aligned in Appendix A).

| `ContentSpec` variant | JSON-LD `@type`                                         |
| --------------------- | ------------------------------------------------------- |
| `image`               | `["swarm-cat:CatalogItem", "sc:ImageObject"]`           |
| `video`               | `["swarm-cat:CatalogItem", "sc:VideoObject"]`           |
| `audio`               | `["swarm-cat:CatalogItem", "sc:AudioObject"]`           |
| `text`                | `["swarm-cat:CatalogItem", "sc:TextDigitalDocument"]`   |
| `document`            | `["swarm-cat:CatalogItem", "sc:CreativeWork"]`          |
| `dataset`             | `["swarm-cat:CatalogItem", "cr:Dataset", "sc:Dataset"]` |
| `bytes`               | `["swarm-cat:CatalogItem", "sc:MediaObject"]`           |

---

## Part 8 — Content-Type Use Cases

This part illustrates the JSON-LD shape for each content type. Examples are abbreviated except for the dataset case, which shows the full Croissant integration.

### 8.1 Croissant datasets

For tabular or structured data, the leaf co-types `cr:Dataset` and `sc:Dataset`. Croissant's record-set structure describes the data; schema.org descriptors locate it. Sample data is referenced in `/sample/`.

```json
{
  "@context": "https://swarm-ai-catalog.eth/v1",
  "@type": ["swarm-cat:CatalogItem", "cr:Dataset", "sc:Dataset"],
  "id": "9c3a1f...",
  "name": "Open-source library commit corpus",
  "description": "Commits, authors, and diffs from 50k OSS repos, normalized for ML training.",
  "encodingFormat": "application/x-parquet",
  "contentSize": 2147483648,
  "license": "https://opensource.org/licenses/Apache-2.0",
  "cr:conformsTo": "http://mlcommons.org/croissant/1.1",
  "cr:recordSet": [
    {
      "@type": "cr:RecordSet",
      "name": "commits",
      "field": [
        { "@type": "cr:Field", "name": "sha", "dataType": "sc:Text" },
        { "@type": "cr:Field", "name": "author_email", "dataType": "sc:Text" },
        { "@type": "cr:Field", "name": "timestamp", "dataType": "sc:DateTime" },
        { "@type": "cr:Field", "name": "additions", "dataType": "sc:Integer" },
        { "@type": "cr:Field", "name": "deletions", "dataType": "sc:Integer" }
      ]
    }
  ],
  "swarm-cat:isMultiFile": true,
  "storage": {
    "reference": "9c3a1f..."
  },
  "payment": [
    {
      "scheme": "exact",
      "chainId": "eip155:8453",
      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "5000000",
      "payTo": "0xabcd...1234"
    }
  ],
  "sample": {
    "@type": "swarm-cat:SampleSpec",
    "kind": "subset",
    "path": "sample/preview.parquet",
    "encodingFormat": "application/x-parquet",
    "contentSize": 1048576
  },
  "lifecycle": "active",
  "version": "1.2.0",
  "dateAdded": "2026-04-01T00:00:00Z",
  "dateModified": "2026-05-10T00:00:00Z"
}
```

### 8.2 Images

For an image asset, use `sc:ImageObject`. The schema.org `width` and `height` integers refer to pixels.

```json
{
  "@type": ["swarm-cat:CatalogItem", "sc:ImageObject"],
  "encodingFormat": "image/png",
  "width": 1920,
  "height": 1080,
  "contentSize": 524288,
  "swarm-cat:colorSpace": "sRGB",
  ...
}
```

### 8.3 Video

For a video asset, use `sc:VideoObject`. The `duration` field is an ISO 8601 duration string (e.g. `"PT12M34S"` for 12 minutes 34 seconds). `bitrate` is in bits per second. `fps`, `codec`, and `hasAudio` are `swarm-cat:` extensions.

```json
{
  "@type": ["swarm-cat:CatalogItem", "sc:VideoObject"],
  "encodingFormat": "video/mp4",
  "width": 3840,
  "height": 2160,
  "duration": "PT15M00S",
  "bitrate": 25000000,
  "contentSize": 2812500000,
  "swarm-cat:fps": 30,
  "swarm-cat:codec": "h264",
  "swarm-cat:hasAudio": true,
  ...
}
```

### 8.4 Audio

For an audio asset, use `sc:AudioObject`. Sample rate, channel count, and codec are `swarm-cat:` extensions.

```json
{
  "@type": ["swarm-cat:CatalogItem", "sc:AudioObject"],
  "encodingFormat": "audio/flac",
  "duration": "PT3M42S",
  "contentSize": 41943040,
  "bitrate": 1411200,
  "swarm-cat:codec": "flac",
  "swarm-cat:channels": 2,
  "swarm-cat:sampleRate": 44100,
  ...
}
```

### 8.5 Text / Documents

For natural-language text, use `sc:TextDigitalDocument`. For richer creative work (articles, papers, code), use `sc:CreativeWork`. The `inLanguage` field is BCP-47; `wordCount` is the word count.

```json
{
  "@type": ["swarm-cat:CatalogItem", "sc:TextDigitalDocument"],
  "encodingFormat": "text/markdown",
  "inLanguage": "en",
  "wordCount": 18432,
  "contentSize": 124800,
  ...
}
```

### 8.6 Byte streams

For opaque binary content (model weights, encrypted bundles, anything without an inherent typed structure), use `sc:MediaObject` and rely on `encodingFormat` plus `swarm-cat:` extensions for ML-specific metadata.

```json
{
  "@type": ["swarm-cat:CatalogItem", "sc:MediaObject"],
  "encodingFormat": "application/octet-stream",
  "contentSize": 4831838208,
  "swarm-cat:modelArchitecture": "transformer",
  "swarm-cat:parameters": 7000000000,
  ...
}
```

---

## Part 9 — Sample Data Architecture

### 9.1 Two-tier preview

Catalog items may offer two tiers of preview before purchase:

1. **Thumbnail-grade preview.** Small, embedded directly in the Mantaray (a thumbnail image, a 5-second audio clip, a 10-row CSV head). Intended for list views. Fetched without ACT. Always open-access.
2. **Full sample.** A substantive but degraded preview — a low-resolution version of an image set, a sample of the dataset's rows, a clipped video. Lives in `/sample/`. Always open-access (no ACT) but MAY be on the same postage stamp as the priced content.

Both tiers are optional. A publisher MAY ship just the thumbnail, just the sample, both, or neither (then the listing is "buy blind").

### 9.2 Degradation conventions

Samples are deliberately _worse_ than the paid product. Recommended degradation per content type:

| Content type        | Recommended degradation                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| Image set           | Lower resolution (e.g. 25% of pixels), and/or a subset of images, and/or watermarked |
| Video               | Lower resolution, fps, or bitrate; or a short clip                                   |
| Audio               | Short clip (10-30s) or downsampled (e.g. 64 kbps)                                    |
| Tabular dataset     | Sample of N rows (typically 100-1000) from the full corpus                           |
| Text/document       | First few paragraphs, or table of contents                                           |
| Byte stream / model | A sample inference output or evaluation metrics, not the weights                     |

The protocol does not enforce degradation. A publisher who ships a full-quality "sample" is undercutting their own purchase price; consumers will notice. The convention exists so that legitimate previews don't accidentally leak the paid product.

### 9.3 Multi-file and collections

For multi-file paid assets (image sets, document collections, sharded datasets), the sample subdirectory mirrors the structure but with fewer files. A `/sample/manifest.json` MAY enumerate the sample's contents with the same descriptor fields as the paid asset:

```json
{
  "files": [
    {
      "path": "img_001.jpg",
      "encodingFormat": "image/jpeg",
      "width": 480,
      "height": 270,
      "contentSize": 32768
    },
    {
      "path": "img_002.jpg",
      "encodingFormat": "image/jpeg",
      "width": 480,
      "height": 270,
      "contentSize": 30540
    }
  ]
}
```

This is a publisher convenience; the canonical descriptor remains the `sample` field in `item.jsonld`.

### 9.4 Stamp lifecycle

Sample content lives on the same Swarm postage stamps as the priced asset by default. Publishers MAY use separate stamps for samples if they want to retire previews independently of paid content. If sample stamps expire, the `/sample/` paths still exist in the Mantaray but their references no longer resolve — consumers see a 404-equivalent and SHOULD fall back to rendering the listing without a preview.

Publishers MUST NOT rely on sample expiry as a means of revoking sample access; that's not what stamp expiry guarantees. To remove sample access cleanly, edit the catalog Mantaray.

---

## Part 10 — HTTP API

This is the minimal HTTP surface a publisher must expose. The required endpoint is the purchase endpoint (§10.1). Read gateways (§10.4, §10.5) are optional and pass-through-only.

### 10.1 Purchase endpoint

```
POST /v1/items/{itemId}/purchase
```

Atomic three-phase flow: discovery (without `X-Payment` header → 402 challenge), settlement (with `X-Payment` header), and grant (200 OK with `ActGrantResult`).

**Phase 1: Discovery (no payment header).**

Request:

```
POST /v1/items/9c3a1f.../purchase
Content-Type: application/json

{
  "granteePublicKey": "0x04abcd...ef01"
}
```

The `granteePublicKey` is the **consumer's Bee-node public key**, in 0x-prefixed uncompressed-or-compressed secp256k1 form. This is the key that will receive the ACT grant. It is NOT the consumer's payment wallet address.

Response: `402 Payment Required` with x402-compliant body:

```json
{
  "x402Version": 1,
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxAmountRequired": "5000000",
      "payTo": "0xabcd...1234",
      "resource": "https://publisher.example/v1/items/9c3a1f.../purchase",
      "description": "Open-source library commit corpus v1.2.0",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 600,
      "extra": {
        "facilitator": "https://facilitator.x402.org",
        "purchaseIntentVersion": "1",
        "purchaseIntentDomain": {
          "name": "Swarm AI Data Exchange",
          "version": "1",
          "chainId": 8453,
          "verifyingContract": "0xabcd...1234"
        }
      }
    }
  ]
}
```

**Phase 2: Settlement (with payment header).**

The consumer constructs a `PurchaseIntent` (see Part 11), signs it via EIP-712, base64-encodes it, and retries:

```
POST /v1/items/9c3a1f.../purchase
Content-Type: application/json
X-Payment: <base64-encoded PurchaseIntent envelope>

{
  "granteePublicKey": "0x04abcd...ef01"
}
```

The server verifies the signature, calls the Facilitator's `/verify` endpoint, then `/settle`, then issues the ACT grant. On success:

**Phase 3: Grant response.**

```
HTTP/1.1 200 OK
Content-Type: application/json
X-Payment-Response: <base64-encoded SettlementResponse>

{
  "itemId": "9c3a1f...",
  "actHistoryRef": "5d2b8e...",
  "grantTo": "0x04abcd...ef01",
  "reference": "9c3a1f...",
  "txHash": "0xdeadbeef...cafe",
  "grantedAt": "2026-05-18T12:34:56Z"
}
```

The consumer now retrieves the content from any Bee node by presenting their Bee-node key and the `actHistoryRef`.

### 10.2 402 challenge details

The 402 body MUST be valid x402 v1 JSON. The publisher MAY include multiple `accepts` entries for cross-chain or cross-asset support; the consumer picks one and signs intent matching it.

The `extra` block carries the EIP-712 domain parameters the consumer needs to build a valid `PurchaseIntent` signature. Publishers MUST include these.

### 10.3 Post-purchase retrieval

There is no publisher-side retrieval endpoint. After `ActGrantResult` is returned, the consumer fetches the content directly from any Bee node, using their Bee-node key plus the `actHistoryRef` to obtain the decryption material.

This is essential: it means the publisher's server is not a bottleneck for content delivery, and a publisher who stops running their gateway does not break already-purchased content.

### 10.4 Catalog read gateway (optional)

```
GET /v1/catalog
```

Optional convenience endpoint for non-Bee web clients. MUST be a pass-through to the catalog feed. Response body is the bare Mantaray root reference, 64-char lowercase hex string, returned as `text/plain`:

```
HTTP/1.1 200 OK
Content-Type: text/plain
Cache-Control: no-cache

a3f2c8d1e4b7f0a3c8...
```

No JSON envelope, no synthesized item list, no preprocessing. Web clients that want the listing fetch this reference via a Bee gateway and walk the Mantaray themselves (or use Bazaar).

### 10.5 State feed read gateway (optional)

```
GET /v1/state/{itemId}
```

Optional convenience endpoint for **verification purposes only**. MUST be a pass-through: return the raw `CatalogItemState` JSON from the latest state-feed update. No transformation, no enrichment, no synthesized envelope.

This endpoint exists to support two consumer use cases:

- Retrieving the current ACT history reference when a previously-cached one no longer suffices to fetch granted content.
- Retrieving the current `granteeRef` to verify the publisher's lifecycle claim, or to follow into the grantee chunks for a cryptographically grounded purchase count (§14.4).

It is **not** a subscription channel for content updates. Consumers MUST NOT poll it for popularity or "new version" signals; those belong to the catalog Mantaray. Implementers MAY rate-limit this endpoint aggressively or omit it entirely; the canonical path is direct SOC-feed read via any Bee node.

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "itemId": "9c3a1f...",
  "actHistoryRef": "5d2b8e...",
  "granteeRef": "c4f1a7d0b3e6c9f2a5d8e1b4c7f0a3d6c9f2b5e8a1d4c7f0a3d6c9f2b5e8a1d4",
  "lifecycle": "active",
  "version": "1.2.0",
  "catalogRootAtUpdate": "a3f2c8...",
  "dateModified": "2026-05-18T12:30:00Z"
}
```

---

## Part 11 — PurchaseIntent

### 11.1 Purpose / threat model

`PurchaseIntent` is the EIP-712-signed envelope that binds a payment authorization to a specific Bee-node public key for ACT delegation. Without it, the protocol cannot safely separate the consumer's payment wallet from their content-receiving identity.

The threat model addresses two specific attacks:

1. **Front-running the grant.** Without intent-signing, an attacker observing a 402 response and a public x402 payment authorization could attempt to attach a different `granteePublicKey` to the same payment authorization, hijacking the ACT grant. Intent-signing binds the grant target to the payment.
2. **Replay across items or domains.** Without typed data signing, a signature for one item could be replayed against another, or across publishers. EIP-712 typed data signing with a domain separator and an itemId in the typed struct prevents this.

### 11.2 Wallet / Bee-node key separation

A consumer in this protocol has two cryptographic identities:

- **Payment wallet.** An EVM EOA that holds USDC (or other supported assets) and signs the EIP-712 `PurchaseIntent`. This is the same wallet whose `transferWithAuthorization` signature the publisher's settlement step uses.
- **Bee-node key.** A separate secp256k1 key controlled by the consumer's Bee node, used for ACT decryption.

Why two keys:

- The payment wallet may be a hardware wallet, a multisig, or a custodial account; demanding it also be the ACT recipient would either compromise wallet security (forcing hot-key operation) or make ACT-protected content unusable.
- The Bee node is online by definition (it has to fetch and decrypt). It needs its own hot key.
- Future agentic flows (an agent purchasing data on behalf of a user) want even cleaner separation: the user's wallet pays, the agent's Bee node receives content.

`PurchaseIntent` binds the two: the wallet signs an intent that names the Bee-node public key as the grant target.

### 11.3 EVM-only scope

v1 is EVM-only:

- `PurchaseIntent` is signed with EIP-712 typed data
- The payment authorization is ERC-3009 `transferWithAuthorization`
- The domain separator's `chainId` is an EVM chain id

Non-EVM payments are out-of-scope for v1. A future version may add alternate intent envelopes (e.g. Solana, Cosmos); the type definitions should be extensible enough to accommodate them without breaking changes.

### 11.4 Wire format

The `X-Payment` header carries a base64-encoded JSON envelope:

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "eip155:8453",
  "payload": {
    "purchaseIntent": {
      "domain": {
        "name": "Swarm AI Data Exchange",
        "version": "1",
        "chainId": 8453,
        "verifyingContract": "0xabcd...1234"
      },
      "types": {
        "PurchaseIntent": [
          { "name": "itemId", "type": "string" },
          { "name": "granteePublicKey", "type": "bytes" },
          { "name": "payment", "type": "Payment" },
          { "name": "nonce", "type": "bytes32" },
          { "name": "validAfter", "type": "uint256" },
          { "name": "validBefore", "type": "uint256" }
        ],
        "Payment": [
          { "name": "scheme", "type": "string" },
          { "name": "asset", "type": "string" },
          { "name": "amount", "type": "uint256" },
          { "name": "payTo", "type": "address" }
        ]
      },
      "primaryType": "PurchaseIntent",
      "message": {
        "itemId": "9c3a1f...",
        "granteePublicKey": "0x04abcd...ef01",
        "payment": {
          "scheme": "exact",
          "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "amount": "5000000",
          "payTo": "0xabcd...1234"
        },
        "nonce": "0x3f7c8e...d291",
        "validAfter": 1747570000,
        "validBefore": 1747573600
      },
      "signature": "0xde1c...7f04"
    },
    "authorization": {
      "from": "0xconsumer...wallet",
      "to": "0xabcd...1234",
      "value": "5000000",
      "validAfter": 1747570000,
      "validBefore": 1747573600,
      "nonce": "0x3f7c8e...d291",
      "signature": "0x91a5...fe12"
    }
  }
}
```

Key invariants the consumer MUST maintain:

- `PurchaseIntent.message.payment.amount` equals `authorization.value`
- `PurchaseIntent.message.payment.payTo` equals `authorization.to`
- `PurchaseIntent.message.nonce` equals `authorization.nonce`
- `PurchaseIntent.message.validAfter` and `validBefore` equal those in `authorization`

The intent and the authorization MUST be co-signed by the **same EOA** (the consumer's payment wallet).

### 11.5 Server verification

The publisher's purchase endpoint MUST run these checks in order. Any failure → reject with the appropriate error code (Part 15).

1. **Parse and decode** the `X-Payment` header. → `intent_malformed` on parse error.
2. **Verify the EIP-712 signature** on `PurchaseIntent.message` using the embedded `domain` and `types`. → `intent_signature_invalid`.
3. **Check domain match.** `domain.chainId` and `domain.verifyingContract` MUST equal the values the publisher advertised in the 402 `extra.purchaseIntentDomain`. → `intent_domain_mismatch`.
4. **Check item match.** `message.itemId` MUST equal the path's `{itemId}`. → `intent_item_mismatch`.
5. **Check payment match.** `message.payment` MUST be consistent with one of the publisher's advertised `accepts` entries. → `intent_payment_mismatch`.
6. **Check time window.** Current Unix time MUST be in `[validAfter, validBefore]`. → `intent_expired` or `intent_not_yet_valid`.
7. **Check nonce freshness.** The nonce MUST NOT have been used before. → `intent_replay`.
8. **Verify the authorization** against `payment.payTo`, `payment.amount`, and the same nonce/window via the Facilitator's `/verify` endpoint. → `payment_verify_failed`.
9. **Settle** via the Facilitator's `/settle`. → `payment_settle_failed`.
10. **Issue ACT grant** to `message.granteePublicKey`. → `act_grant_failed`.
11. **Update state feed** with the new ACT history reference and the new grantee reference produced by the grant. → `state_feed_failed` (non-fatal if grant already issued; SHOULD be retried, MUST NOT cause the user to lose access).
12. **Return** `ActGrantResult` (§6.5, §17.7).

Steps 1-8 are reversible — failure leaves no state change. Steps 9-11 are committing — once `/settle` returns success, the publisher MUST issue the grant. If `act_grant_failed` after settlement, the publisher MUST retry until success and SHOULD provide a recovery endpoint for the consumer to re-trigger grant issuance.

### 11.6 AP2 forward-compat

The Agent Payments Protocol 2 (AP2) is a likely future evolution of agent-to-agent payment authorization. To keep this spec forward-compatible:

- The `PurchaseIntent` typed struct uses a `nonce` (bytes32) and a time window, both of which AP2 envelopes preserve.
- The `granteePublicKey` field generalizes to "the receiving identity" in AP2 terms.
- A future spec MAY add an alternate `payload.purchaseIntent` shape (e.g. an AP2 envelope) alongside the EIP-712 form; clients select by `x402Version` or a new field.

v1 implementers MUST NOT depend on AP2-specific fields. They MAY emit additional `extra` fields in 402 responses as long as `payload.purchaseIntent` keeps its v1 shape.

---

## Part 12 — Publisher Flow

### 12.1 Builder abstraction

Publishing is mediated by a builder (the `SwarmCatalogBuilder` referenced in Appendix A). The builder accepts high-level `CatalogItem` inputs and produces:

1. The asset uploads (priced content, samples)
2. ACT envelopes for priced content
3. The catalog Mantaray
4. The catalog feed update
5. Initial state feeds for new items

A publisher does not directly construct JSON-LD; they hand TypeScript inputs to the builder, which produces JSON-LD leaves.

### 12.2 Step-by-step walkthrough

A complete publish-an-item flow:

1. **Upload priced content** to Swarm under the publisher's stamp. Capture the reference.
2. **Wrap with ACT.** All v1 priced content is ACT-protected. Create an initial grantee list containing the publisher's own Bee-node public key (so the publisher can decrypt for testing/management), then encrypt and create the initial ACT envelope. Capture both the initial `actHistoryRef` and the initial `granteeRef` — these values seed the state feed in step 8, NOT the catalog leaf.
3. **Upload samples** to Swarm. Capture references and sample manifest.
4. **Build the JSON-LD leaf** using the priced-content reference as `id`, populating storage / payment / content / sample / lifecycle fields. Upload `item.jsonld`.
5. **Mutate the catalog Mantaray.** Either start from the last catalog root (fetched via the feed) and copy-on-write, or build from scratch if first publish. Insert `/items/{itemId}/item.jsonld` and `/items/{itemId}/sample/*`. Set inline fork metadata on `/items/{itemId}/` per §5.5.
6. **Upload the new Mantaray** and capture the new root reference.
7. **Push catalog feed update** with the new root.
8. **Initialize the state feed** for this item: upload a `CatalogItemState` with the initial `actHistoryRef` and `granteeRef` from step 2, `lifecycle: "active"`, then push the state-feed update.

The builder SHOULD batch steps 5-8 across multiple items in one session.

### 12.3 Validation rules

The builder MUST reject inputs that violate:

- `id` differs from the priced-content reference
- `payment` is empty
- `lifecycle` is not one of the three valid values
- Required fields per content type are missing (e.g. `width`/`height` for image, `duration` for video)
- Any URL field is not a valid IRI

The builder SHOULD warn on:

- License missing
- Tags exceeding a soft cap (suggested: 20)
- Sample missing on items with non-trivial price (suggested threshold: 1 USDC equivalent)

### 12.4 Batching

For batches of N items, the builder MUST publish a single Mantaray covering all of them and a single catalog feed update. State feeds for new items MAY be initialized in parallel after the catalog feed update has landed.

The builder MAY support a dry-run mode that produces the Mantaray locally without uploading, for verification.

### 12.5 Atomicity and crash recovery

If the builder crashes between steps:

- **Crash between Mantaray upload (step 6) and feed update (step 7):** the new Mantaray exists on Swarm but is not reachable via the feed. The builder MUST detect this on restart (by checking the feed vs its local intent) and either retry the feed update or re-build with current intent.
- **Crash between feed update (step 7) and state-feed init (step 8):** the catalog references the new item but its state feed is empty. The item is not yet purchasable — without a state feed there is no canonical place for the publisher's ACT-state writes to land. The builder MUST detect this on restart (by checking each catalog item against the existence of its state feed) and complete state-feed init before declaring publish complete. The purchase endpoint MUST refuse to serve items whose state feed is missing.

Crash-recovery semantics imply the builder MUST persist its publishing intent (the desired catalog state) somewhere it can resume from. This persistence is publisher-implementation-defined.

---

## Part 13 — Reader Flow

### 13.1 List view

To render a catalog list view:

1. Resolve the catalog feed via `(owner, topic)` where `owner` is read from the Agent Card's `"swarm-ai-catalog"` services entry and `topic = keccak256("swarm-ai-catalog.v1")`. Read the latest update → 64-byte payload → Mantaray root reference.
2. Fetch the Mantaray root. Enumerate forks under `/items/`.
3. For each fork, read inline metadata (per §5.5). These suffice for a list-view tile: name, content type, encoding, price, tags, version, lifecycle.
4. For each item the user opens, fetch `/items/{itemId}/item.jsonld` for the full JSON-LD record.

This walk runs entirely against Swarm via the consumer's Bee node. No publisher server is contacted.

### 13.2 Detail view

Detail view requires the full `item.jsonld` (step 4 above). It also typically requires:

- Sample content from `/items/{itemId}/sample/*`

Sample content is fetched the same way as `item.jsonld`: directly via Swarm.

Detail view does NOT require reading the per-item state feed. Lifecycle, version, and all descriptive fields come from the catalog. The state feed is consulted only at purchase time (by the publisher) and post-purchase verification (by the consumer who needs the current ACT history reference).

### 13.3 Sample preview

For sample preview rendering:

1. Read `item.jsonld.sample` for the sample descriptor.
2. Fetch the sample blob(s) at `/items/{itemId}/sample/...` paths.
3. Render in-app: image at lower resolution, video clip, audio clip, dataset head, etc.

Consumers SHOULD show clearly that this is a sample and not the full asset.

### 13.4 Cursor pagination

For large catalogs, naïve full-Mantaray enumeration is expensive. Consumers SHOULD use Mantaray's lexicographic fork iteration to paginate by `itemId`:

- A "cursor" is just the last `itemId` rendered.
- Next page fetches the next N forks whose key is lexicographically > cursor.

Because itemIds are content references, their lexicographic order is essentially random — pagination is stable but not semantically ordered. Consumers wanting time-ordered or tag-filtered views SHOULD use Bazaar (which indexes inline metadata) or fetch all forks once and cache.

### 13.5 Bazaar indexing

Bazaar (and any analogous indexer) walks the catalog Mantaray and the inline metadata to build aggregated views: cross-publisher search, tag-faceted browse, leaderboards. Bazaar:

- MUST treat the on-Swarm catalog as the source of truth.
- MUST re-validate by re-reading the catalog feed periodically; the Mantaray root change is the signal that the index needs refresh for that publisher.
- MAY synthesize derived data (popularity, trending) from external signals: its own walk activity, consumer interactions in Bazaar's own UI, observed on-chain settlement transactions. Bazaar MUST NOT use per-item state feeds as a popularity or activity source; those feeds are publisher ACT-state records, not analytics streams.
- MUST NOT expose itself as a write path to the catalog (no "edit" API on Bazaar).

---

## Part 14 — Per-Item State Feed Protocol

### 14.1 Write flow (publisher, post-grant)

The state feed is the publisher's authoritative record of an item's ACT-state. Writes are triggered by ACT-state changes — overwhelmingly: a successful purchase resulting in a new grant. After `/settle` returns OK and the new ACT grant has been issued (advancing the ACT history and producing a new grantee-list reference), the publisher's purchase service:

1. Fetches the current `CatalogItemState` from the item's state feed.
2. Sets `actHistoryRef` to the new ACT history head produced by the grant.
3. Sets `granteeRef` to the new grantee-list reference returned by `patchGrantees`. Together with step 2, this is the primary write — the on-Swarm record of advancing ACT state.
4. Sets `dateModified` to now.
5. Optionally sets `catalogRootAtUpdate` to the current catalog root.
6. Uploads the new state JSON to Swarm.
7. Pushes a state-feed update with the new reference.

If grant issuance succeeded but the state-feed write fails, the purchase still succeeded — the consumer holds their grant — but the publisher's on-Swarm ACT record is now lagging the actual ACT history. The publisher MUST retry the state-feed write. The consumer's `ActGrantResult.actHistoryRef` (returned at purchase) remains the consumer's working reference until they need to verify against the canonical record.

The publisher MAY also write to the state feed in response to administrative actions: a lifecycle change pushed after a catalog republish (§14.3), a version bump, a manual ACT-history correction.

### 14.2 Read flow (verification only)

The state feed is read by:

- **The publisher itself**, on every purchase, to fetch the prior state before writing the next one.
- **Consumers, for verification only.** Acceptable consumer reads:
  - Retrieving the current `actHistoryRef` when a previously-cached one no longer resolves correctly to the consumer's grant.
  - Retrieving the current `granteeRef` to verify a publisher's lifecycle claim, or to follow the reference into the grantee chunks for a cryptographically grounded purchase count (§14.4).

Consumer reads MUST NOT be polling subscriptions for content-update notifications. Discovery, lifecycle awareness, and version awareness for browsing all happen through the catalog Mantaray (`item.jsonld`), not the state feed.

The mechanics of a read are:

1. Compute the state-feed topic per §4.2.
2. Resolve `(owner=publisher's state-feed signer, topic)`.
3. Fetch the latest update payload → reference → fetch the JSON document.

For HTTP-only clients, the optional state-feed read gateway (§10.5) provides the same data as a pass-through; it is rate-limited and marked verification-only.

### 14.3 Lifecycle changes

Lifecycle transitions (active → deprecated → retired) are catalog-level changes, not state-level. When a publisher deprecates an item:

1. Update `item.jsonld` with `lifecycle: "deprecated"` and `swarm-cat:supersededBy` if a replacement exists.
2. Republish the catalog (new Mantaray, new feed update).
3. Push a state-feed update with the new lifecycle so the publisher's own ACT-state record is consistent.

The catalog is authoritative for lifecycle. Step 3 keeps the state feed internally consistent with what the publisher has published; consumers reading the catalog see the new lifecycle directly without consulting the state feed.

### 14.4 Analytics, popularity, and what does NOT live in the state feed

The state feed deliberately omits analytics-shaped fields — purchase counters, recent-purchase snapshots, velocity, leaderboards. The legitimate signals each have a better home:

- **Cryptographically grounded purchase count.** The size of the ACT grantee list grows by exactly one entry per successful purchase. An observer derives the count by: (1) reading the latest `CatalogItemState`, (2) following `granteeRef` to the ACT grantee chunks, (3) counting entries and subtracting one for the publisher's own initial entry. This is self-verifying — a publisher cannot inflate it (fake entries would not grant real decryption) or deflate it without revoking real buyers' access. The count is more expensive to compute than a stored counter would be, but analytics is not on the hot path.

- **Marketplace-scale popularity, trends, time series.** These belong to the Marketplace Event Collector or equivalent off-chain indexer, which subscribes to x402 settlement events on-chain and produces aggregate analytics across publishers. Bazaar and similar discovery layers consume Event Collector aggregates; they MUST NOT read per-item state feeds for popularity (see Part 13.5).

- **Liveness / freshness.** `dateModified` on `CatalogItemState` is the on-Swarm liveness signal. Repeat consumers verifying their own grant read `dateModified` to confirm the publisher's bookkeeping is still advancing; they do not need (and would be misled by) a snapshot of someone else's recent purchase.

- **Publisher trustworthiness.** ERC-8004 reputation feedback (directional, independently signed, attributable) is the right signal for "is this publisher trustworthy?" — richer than any count.

A mature marketplace UI surfaces grantee-derived count (per item, cryptographically grounded) plus Event Collector aggregates (cross-publisher, time series) plus ERC-8004 reputation (per publisher, qualitative). None of these go in `CatalogItemState`.

### 14.5 Failure handling

State-feed writes that fail post-grant MUST NOT cause the consumer to lose their grant. The protocol assumes:

- ACT grant issuance is the consumer-facing source of truth for "did I buy this?"
- The state feed is the publisher's on-Swarm record of that fact, not the authorization itself.

The consumer's `ActGrantResult` includes the post-grant `actHistoryRef` — this is what the consumer needs to fetch content. If the state feed is temporarily stale, content access is not affected. The publisher MUST retry state-feed writes until success and SHOULD log the lag for operational monitoring.

If a consumer's cached `actHistoryRef` stops working (e.g. many grants later, their Bee node cannot walk to find their grant from too-old a head), they re-read the state feed for the current head. If the state feed itself is unavailable, the consumer's purchase remains valid — they retry once the publisher restores it.

---

## Part 15 — Error Handling

### 15.1 Envelope

All publisher-server errors use a uniform JSON envelope:

```json
{
  "error": "intent_signature_invalid",
  "message": "EIP-712 signature failed to recover the expected EOA",
  "details": {
    "expected": "0xconsumer...wallet",
    "recovered": "0x0000...0000"
  },
  "retryable": false
}
```

| Field       | Type    | Required | Description                                              |
| ----------- | ------- | -------- | -------------------------------------------------------- |
| `error`     | string  | Yes      | Error code from the catalog below                        |
| `message`   | string  | Yes      | Human-readable description                               |
| `details`   | object  | No       | Code-specific structured details                         |
| `retryable` | boolean | Yes      | Whether the consumer can retry without changing anything |

### 15.2 Code catalog

| Code                       | HTTP | Retryable   | Description                                                                                         |
| -------------------------- | ---- | ----------- | --------------------------------------------------------------------------------------------------- |
| `item_not_found`           | 404  | No          | The `{itemId}` does not exist in the catalog                                                        |
| `item_retired`             | 410  | No          | The item has lifecycle `retired` and is not purchasable                                             |
| `payment_required`         | 402  | n/a         | The 402 challenge response (not strictly an error)                                                  |
| `intent_malformed`         | 400  | No          | `X-Payment` header could not be decoded                                                             |
| `intent_signature_invalid` | 400  | No          | EIP-712 signature did not recover the expected EOA                                                  |
| `intent_domain_mismatch`   | 400  | No          | `domain.chainId` or `domain.verifyingContract` does not match server advertised values              |
| `intent_item_mismatch`     | 400  | No          | `message.itemId` does not match path                                                                |
| `intent_payment_mismatch`  | 400  | No          | `message.payment` does not match any of the publisher's `accepts`                                   |
| `intent_expired`           | 400  | No          | `validBefore` is in the past                                                                        |
| `intent_not_yet_valid`     | 400  | Yes (later) | `validAfter` is in the future                                                                       |
| `intent_replay`            | 409  | No          | Nonce has been used                                                                                 |
| `payment_verify_failed`    | 402  | No          | Facilitator rejected the authorization                                                              |
| `payment_settle_failed`    | 502  | Yes         | Facilitator settlement failed (transient); MAY retry                                                |
| `act_grant_failed`         | 500  | Yes         | ACT delegation failed after settlement; publisher MUST retry; consumer MAY poll a recovery endpoint |
| `state_feed_failed`        | 500  | n/a         | Logged but does NOT fail the response if grant succeeded                                            |
| `internal_error`           | 500  | Yes         | Unspecified server failure                                                                          |

Consumers SHOULD show user-facing language based on `message`, with `error` used for programmatic handling.

---

## Part 16 — Consumer Integration

### 16.1 MCP

For LLM-based agents using MCP, the natural integration shape is a Swarm-AI-Catalog MCP server exposing:

- `catalog.list(catalogFeedOwner: string) → CatalogItem[]` (under the hood: walk the catalog Mantaray; the owner address is read upstream from the Agent Card's services entry)
- `catalog.get(itemId) → CatalogItem`
- `catalog.sample(itemId) → SampleData` (resolves and returns sample bytes/JSON)
- `catalog.purchase(itemId, walletSigner) → ActGrantResult` (drives the full 402 → settle → grant flow)
- `catalog.fetch(itemId) → bytes` (post-purchase content retrieval; requires ACT-enabled Bee access)

Such a server is itself a thin wrapper over Bee-node calls plus the publisher's purchase endpoint. It is OPTIONAL infrastructure; agents that prefer can call the protocol primitives directly.

### 16.2 Bazaar

Bazaar's consumer-side responsibilities:

- Discover Agent Cards (by enumerating ERC-8004 registries across chains and resolving each entry's `tokenURI`, by accepting publisher submissions, or by following Swarm feed references shared out-of-band)
- For each Agent Card, read the `"swarm-ai-catalog"` services entry to find the catalog feed owner address, then walk the catalog (read feed → fetch Mantaray → enumerate forks → cache inline metadata)
- Index for search, filter, sort
- Optionally proxy purchase flows (with consumer wallet signing the intent end-to-end)

**Agent attribution as an indexer concern.** This catalog spec is deliberately identity-agnostic at the catalog level; items and catalog documents carry no on-chain agent identifiers. Indexers and aggregators that want to surface items by agent — for example, an "Acme Labs storefront" view that combines all of Acme's catalogs across chains — perform that join themselves, using each Agent Card as the authoritative pivot: the Card's `registrations[]` enumerates the agent's on-chain registrations across chains and registries, and the Card's services entry pins the catalog feed owner. This keeps the catalog-protocol surface narrow and the agent-attribution logic owned by the layer that has the strongest incentive to keep it accurate.

Bazaar MUST NOT consume per-item state feeds as a discovery, popularity, or notification source. Those feeds are publisher ACT-state records; reading them at scale would conflate operational data with discovery data and create a false expectation that publishers maintain them as public analytics streams. Popularity and trending signals SHOULD come from Bazaar's own observations (catalog walks, UI interactions) and from on-chain settlement traces.

The protocol does not require Bazaar's existence; it requires that Bazaar be _possible_, which the on-Swarm Mantaray design ensures.

---

## Part 17 — Examples

### 17.1 Mantaray tree (illustrative)

```
/  (root: a3f2c8d1e4b7f0a3c8...)
├── catalog.jsonld
└── items/
    ├── 9c3a1f.../  (dataset)
    │   ├── item.jsonld
    │   └── sample/
    │       ├── manifest.json
    │       └── preview.parquet
    ├── 5e8d2a.../  (image set)
    │   ├── item.jsonld
    │   └── sample/
    │       ├── img_001.jpg
    │       ├── img_002.jpg
    │       └── img_003.jpg
    └── 7b4f9c.../  (video)
        ├── item.jsonld
        └── sample/
            └── preview.mp4
```

### 17.2 catalog.jsonld (full)

```json
{
  "@context": "https://swarm-ai-catalog.eth/v1",
  "@type": ["sc:DataCatalog", "swarm-cat:Catalog"],
  "name": "Acme AI Vision & Code Datasets",
  "description": "Curated training data: images, video, OSS code.",
  "license": "https://example.com/licenses/acme-data-v1",
  "dateModified": "2026-05-18T12:00:00Z",
  "swarm-cat:itemCount": 3,
  "swarm-cat:protocolVersion": "1.0"
}
```

### 17.3 item.jsonld (image)

```json
{
  "@context": "https://swarm-ai-catalog.eth/v1",
  "@type": ["swarm-cat:CatalogItem", "sc:ImageObject"],
  "id": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a",
  "name": "Annotated urban street-scene corpus, daylight",
  "description": "10,000 annotated daylight street scenes from 8 cities. Per-pixel semantic masks, bounding boxes, depth estimates.",
  "encodingFormat": "image/png",
  "width": 1920,
  "height": 1080,
  "contentSize": 5368709120,
  "swarm-cat:colorSpace": "sRGB",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "tags": ["vision", "street", "urban", "annotated", "semantic-segmentation"],
  "version": "2.1.0",
  "storage": {
    "@type": "swarm-cat:SwarmStorage",
    "reference": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a"
  },
  "payment": [
    {
      "@type": "swarm-cat:PaymentRequirements",
      "scheme": "exact",
      "chainId": "eip155:8453",
      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "25000000",
      "payTo": "0xabcdef1234567890abcdef1234567890abcdef12",
      "facilitator": "https://facilitator.x402.org"
    }
  ],
  "sample": {
    "@type": "swarm-cat:SampleSpec",
    "kind": "subset",
    "path": "sample/",
    "encodingFormat": "image/jpeg"
  },
  "lifecycle": "active",
  "dateAdded": "2026-03-15T00:00:00Z",
  "dateModified": "2026-05-01T00:00:00Z"
}
```

### 17.4 CatalogItemState

```json
{
  "itemId": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a",
  "actHistoryRef": "b7e1d9f2c5a8d3e6b9c2f5a8d1e4b7f0c3a6d9e2b5c8f1a4d7e0b3c6f9a2d5e8",
  "granteeRef": "c4f1a7d0b3e6c9f2a5d8e1b4c7f0a3d6c9f2b5e8a1d4c7f0a3d6c9f2b5e8a1d4",
  "lifecycle": "active",
  "version": "2.1.0",
  "catalogRootAtUpdate": "a3f2c8d1e4b7f0a3c8b1d4e7f0a3c8b1d4e7f0a3c8b1d4e7f0a3c8b1d4e7f0a3",
  "dateModified": "2026-05-18T11:42:14Z"
}
```

### 17.5 402 response

```json
{
  "x402Version": 1,
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxAmountRequired": "25000000",
      "payTo": "0xabcdef1234567890abcdef1234567890abcdef12",
      "resource": "https://acme.example/v1/items/5e8d2a.../purchase",
      "description": "Annotated urban street-scene corpus, daylight v2.1.0",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 600,
      "extra": {
        "facilitator": "https://facilitator.x402.org",
        "purchaseIntentVersion": "1",
        "purchaseIntentDomain": {
          "name": "Swarm AI Data Exchange",
          "version": "1",
          "chainId": 8453,
          "verifyingContract": "0xabcdef1234567890abcdef1234567890abcdef12"
        }
      }
    }
  ]
}
```

### 17.6 PurchaseIntent envelope (decoded from X-Payment)

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "eip155:8453",
  "payload": {
    "purchaseIntent": {
      "domain": {
        "name": "Swarm AI Data Exchange",
        "version": "1",
        "chainId": 8453,
        "verifyingContract": "0xabcdef1234567890abcdef1234567890abcdef12"
      },
      "primaryType": "PurchaseIntent",
      "message": {
        "itemId": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a",
        "granteePublicKey": "0x04ab12cd34ef56789012345678901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
        "payment": {
          "scheme": "exact",
          "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "amount": "25000000",
          "payTo": "0xabcdef1234567890abcdef1234567890abcdef12"
        },
        "nonce": "0x3f7c8e91d2914f5b6a8c0e2f4d6a8c0e2f4d6a8c0e2f4d6a8c0e2f4d6a8c0e2f4",
        "validAfter": 1747570000,
        "validBefore": 1747573600
      },
      "signature": "0xde1c4b7e9f2a5c8d1f4b7e0a3d6c9f2b5e8a1d4c7f0b3e6a9d2c5f8b1e4a7d04..."
    },
    "authorization": {
      "from": "0xc0nsumerWalletAddress1234567890abcdef12345678",
      "to": "0xabcdef1234567890abcdef1234567890abcdef12",
      "value": "25000000",
      "validAfter": 1747570000,
      "validBefore": 1747573600,
      "nonce": "0x3f7c8e91d2914f5b6a8c0e2f4d6a8c0e2f4d6a8c0e2f4d6a8c0e2f4d6a8c0e2f4",
      "signature": "0x91a5c8d3f6b9e2c5a8d1f4b7e0a3d6c9f2b5e8a1d4c7f0b3e6a9d2c5f8b1efe12..."
    }
  }
}
```

### 17.7 ActGrantResult

```json
{
  "itemId": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a",
  "actHistoryRef": "b7e1d9f2c5a8d3e6b9c2f5a8d1e4b7f0c3a6d9e2b5c8f1a4d7e0b3c6f9a2d5e8",
  "grantTo": "0x04ab12cd34ef56789012345678901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  "reference": "5e8d2a4c1f0b3e7a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a",
  "txHash": "0xdeadbeef0011223344556677889900aabbccddeeff00112233445566778899ee",
  "grantedAt": "2026-05-18T11:42:13Z"
}
```

### 17.8 Error response example

```json
{
  "error": "intent_payment_mismatch",
  "message": "PurchaseIntent payment terms do not match any advertised accepts entry",
  "details": {
    "intentAmount": "10000000",
    "advertisedAmounts": ["25000000"]
  },
  "retryable": false
}
```

---

## Part 18 — Open Implementation Items

These items are explicitly out of scope for this v1 spec but must be resolved before the protocol can ship in production.

1. **Final ENS name.** `swarm-ai-catalog.eth` is a placeholder. The project must register the actual ENS name, configure its contenthash to point at the canonical context document on Swarm, and update this spec.
2. **Croissant validator profile.** Define the Croissant 1.1 subset / profile required and recommended in v1 leaves. Pick a reference validator implementation.
3. **bee-js inline-metadata API.** The Mantaray inline-metadata setting and reading API in bee-js may not be production-ready for the field set in §5.5. Track upstream and contribute if needed.
4. **Deterministic state-feed topic vs. random.** §4.2 specifies a derivable topic. Alternative: random topic per item, published in `item.jsonld`. Deterministic is simpler; random has minor privacy benefits (an unrelated party cannot enumerate state feeds without first walking the catalog). Pick one and commit.
5. **JSON-LD canonicalization for signing.** If we ever sign `item.jsonld` (e.g. for off-Swarm verification), we need a canonicalization algorithm. URDNA2015 is the standard; we MUST adopt it before introducing any signature-over-leaf.
6. **Decimals lookup for `amount`.** `PaymentRequirements.amount` is in smallest unit. Consumers displaying prices need a decimals lookup. Pick a strategy: per-asset hardcode list, ENS-anchored asset metadata, on-chain decimals call.
7. **Multi-publisher catalogs.** v1 assumes one catalog feed per publishing identity. Federated catalogs (a "marketplace" identity aggregating multiple publishers) are out of scope. Define how Bazaar represents these — likely as virtual catalogs over the union of underlying catalogs.
8. **Optional agent-attribution overlay.** Future versions MAY reintroduce an opt-in publisher field on catalog or item leaves for use cases that need verifiable per-item agent attribution (e.g. items resold across catalogs). v1 deliberately omits this and treats agent attribution as a concern for indexers walking from Agent Cards. If reintroduced, the field should reference the Agent Card's Swarm feed address rather than any individual on-chain registration, to remain chain-agnostic.

---

## Appendix A — TypeScript Reference

These types are the recommended publisher-input SDK shape. They mirror the on-wire JSON-LD field names where possible (schema.org-conformant); see §7.4 for the JSON-LD mapping.

### A.1 Publisher input types

```typescript
// --- SwarmStorage ---
// All v1 priced content is ACT-protected; no flag is carried per item.
// Current ACT history reference lives in CatalogItemState, not here.
export interface SwarmStorage {
  reference: string; // 64-char hex, encrypted content reference
  contentSize?: number; // optional duplicate of ContentSpec.contentSize
}

// --- PaymentRequirements ---
export interface PaymentRequirements {
  scheme: 'exact'; // v1: only 'exact'
  chainId: string; // CAIP-2
  asset: string; // CAIP-19
  amount: string; // smallest-unit, decimal string
  payTo: string; // 0x address
  facilitator?: string; // URL
  description?: string;
}

// --- ContentSpec discriminated union (schema.org-aligned field names) ---
export type ContentSpec =
  | ImageContent
  | VideoContent
  | AudioContent
  | TextContent
  | DocumentContent
  | DatasetContent
  | BytesContent;

export interface ImageContent {
  type: 'image';
  encodingFormat: string; // MIME
  width: number; // pixels
  height: number; // pixels
  contentSize?: number; // bytes
  colorSpace?: string; // swarm-cat extension
}

export interface VideoContent {
  type: 'video';
  encodingFormat: string;
  width: number;
  height: number;
  duration: string; // ISO 8601 duration, e.g. "PT12M34S"
  contentSize?: number;
  bitrate?: number; // bits per second
  fps?: number; // swarm-cat extension
  codec?: string; // swarm-cat extension
  hasAudio?: boolean; // swarm-cat extension
}

export interface AudioContent {
  type: 'audio';
  encodingFormat: string;
  duration: string;
  contentSize?: number;
  bitrate?: number;
  codec?: string; // swarm-cat extension
  channels?: number; // swarm-cat extension
  sampleRate?: number; // swarm-cat extension, Hz
}

export interface TextContent {
  type: 'text';
  encodingFormat: string; // text/plain, text/markdown, application/json, etc.
  contentSize?: number;
  wordCount?: number;
  inLanguage?: string; // BCP-47
}

export interface DocumentContent {
  type: 'document';
  encodingFormat: string; // application/pdf, application/epub+zip, etc.
  contentSize?: number;
  wordCount?: number;
  inLanguage?: string;
}

export interface DatasetContent {
  type: 'dataset';
  encodingFormat: string; // application/x-parquet, text/csv, etc.
  contentSize?: number;
  recordSets?: CroissantRecordSet[];
  isMultiFile?: boolean;
}

export interface CroissantRecordSet {
  name: string;
  fields: CroissantField[];
}

export interface CroissantField {
  name: string;
  dataType: string; // schema.org type, e.g. "sc:Text", "sc:Integer"
}

export interface BytesContent {
  type: 'bytes';
  encodingFormat: string; // application/octet-stream typical
  contentSize?: number;
  modelArchitecture?: string; // swarm-cat extension
  parameters?: number; // swarm-cat extension
}

// --- SampleSpec ---
export interface SampleSpec {
  kind: 'subset' | 'clip' | 'thumbnail' | 'manifest';
  path: string; // relative path under /items/{itemId}/sample/
  encodingFormat?: string;
  contentSize?: number;
}

// --- CatalogItem (publisher input) ---
export interface CatalogItem {
  id: string; // equals storage.reference
  name: string;
  description: string;
  content: ContentSpec;
  storage: SwarmStorage;
  payment: PaymentRequirements[];
  sample?: SampleSpec;
  license: string; // URL or SPDX id
  tags?: string[];
  version?: string;
  lifecycle: 'active' | 'deprecated' | 'retired';
  supersededBy?: string; // itemId, when deprecated
  dateAdded: string; // ISO 8601
  dateModified: string; // ISO 8601
}
```

### A.2 Wire types

```typescript
// --- CatalogItemState (wire) ---
// Primary purpose: track the publisher's ACT-state (current actHistoryRef + granteeRef) for one item.
// Consumer reads MUST be verification-only (never a subscription channel).
// Carries no analytics fields by design — see §14.4.
export interface CatalogItemState {
  itemId: string;
  actHistoryRef: string; // current ACT history reference; advances per grant
  granteeRef: string; // current grantee-list reference; advances per grant
  lifecycle: 'active' | 'deprecated' | 'retired';
  version?: string;
  catalogRootAtUpdate?: string;
  dateModified: string;
}

// --- ActGrantResult (wire) ---
export interface ActGrantResult {
  itemId: string;
  actHistoryRef: string;
  grantTo: string; // hex pubkey
  reference: string;
  txHash: string;
  grantedAt: string; // ISO 8601
  expiresAt?: string; // ISO 8601
}

// --- ApiError (wire) ---
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}
```

### A.3 PurchaseIntent + EIP-712

```typescript
// --- EIP-712 domain ---
export interface Eip712Domain {
  name: string; // "Swarm AI Data Exchange"
  version: string; // "1"
  chainId: number;
  verifyingContract: string; // 0x address
}

// --- PurchaseIntent message ---
export interface PurchaseIntentMessage {
  itemId: string;
  granteePublicKey: string; // 0x-prefixed hex of consumer's Bee-node pubkey
  payment: {
    scheme: 'exact';
    asset: string; // CAIP-19
    amount: string; // uint256 decimal string
    payTo: string; // address
  };
  nonce: string; // bytes32
  validAfter: number; // Unix seconds
  validBefore: number; // Unix seconds
}

// --- EIP-712 types descriptor ---
export const PURCHASE_INTENT_TYPES = {
  PurchaseIntent: [
    { name: 'itemId', type: 'string' },
    { name: 'granteePublicKey', type: 'bytes' },
    { name: 'payment', type: 'Payment' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'payTo', type: 'address' },
  ],
} as const;

// --- Full envelope (decoded X-Payment) ---
export interface PurchasePayload {
  x402Version: 1;
  scheme: 'exact';
  network: string; // CAIP-2
  payload: {
    purchaseIntent: {
      domain: Eip712Domain;
      types: typeof PURCHASE_INTENT_TYPES;
      primaryType: 'PurchaseIntent';
      message: PurchaseIntentMessage;
      signature: string; // 0x-prefixed
    };
    authorization: {
      from: string; // payer address
      to: string; // payee address (same as payment.payTo)
      value: string; // same as payment.amount
      validAfter: number;
      validBefore: number;
      nonce: string; // bytes32, same as message.nonce
      signature: string; // ERC-3009 signature
    };
  };
}
```

### A.4 SwarmCatalogBuilder sketch

```typescript
export class SwarmCatalogBuilder {
  constructor(opts: {
    bee: BeeClient;
    catalogFeedSigner: FeedSigner;
    itemStateFeedSigner: FeedSigner;
    postageBatchId: string;
  }) {
    /* ... */
  }

  // Stage an item; does not upload yet
  stageItem(input: CatalogItem): void;

  // Stage a removal
  stageRemove(itemId: string): void;

  // Stage a lifecycle change
  stageLifecycle(itemId: string, lifecycle: 'active' | 'deprecated' | 'retired'): void;

  // Compute the new Mantaray locally without uploading
  dryRun(): Promise<{ root: string; manifest: MantarayManifest }>;

  // Publish: upload Mantaray, push feed update, init/update state feeds
  publish(): Promise<{
    catalogRoot: string;
    feedUpdateTxId: string;
    stateFeeds: Array<{ itemId: string; reference: string }>;
  }>;
}
```

---

## Appendix B — JSON Schema Fragment

Non-normative JSON Schema fragments for wire validation. These are intentionally incomplete — they cover the most error-prone shapes.

### B.1 CatalogItem input (sketch)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://swarm-ai-catalog.eth/v1/schemas/CatalogItem.json",
  "type": "object",
  "required": [
    "id",
    "name",
    "description",
    "content",
    "storage",
    "payment",
    "license",
    "lifecycle",
    "dateAdded",
    "dateModified"
  ],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "name": { "type": "string", "minLength": 1, "maxLength": 200 },
    "description": { "type": "string", "minLength": 1 },
    "storage": { "$ref": "#/$defs/SwarmStorage" },
    "payment": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/PaymentRequirements" }
    },
    "license": { "type": "string", "minLength": 1 },
    "tags": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9-]+$" },
      "uniqueItems": true
    },
    "lifecycle": { "enum": ["active", "deprecated", "retired"] },
    "dateAdded": { "type": "string", "format": "date-time" },
    "dateModified": { "type": "string", "format": "date-time" }
  },
  "$defs": {
    "SwarmStorage": {
      "type": "object",
      "required": ["reference"],
      "properties": {
        "reference": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "contentSize": { "type": "integer", "minimum": 0 }
      }
    },
    "PaymentRequirements": {
      "type": "object",
      "required": ["scheme", "chainId", "asset", "amount", "payTo"],
      "properties": {
        "scheme": { "const": "exact" },
        "chainId": { "type": "string", "pattern": "^eip155:[0-9]+$" },
        "asset": { "type": "string" },
        "amount": { "type": "string", "pattern": "^[0-9]+$" },
        "payTo": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" }
      }
    }
  }
}
```

### B.2 CatalogItemState (sketch)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["itemId", "actHistoryRef", "granteeRef", "lifecycle", "dateModified"],
  "properties": {
    "itemId": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "actHistoryRef": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "granteeRef": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "lifecycle": { "enum": ["active", "deprecated", "retired"] },
    "version": { "type": "string" },
    "catalogRootAtUpdate": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "dateModified": { "type": "string", "format": "date-time" }
  }
}
```

### B.3 ApiError (sketch)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["error", "message", "retryable"],
  "properties": {
    "error": { "type": "string", "minLength": 1 },
    "message": { "type": "string", "minLength": 1 },
    "details": { "type": "object" },
    "retryable": { "type": "boolean" }
  }
}
```

### B.4 SHACL note for JSON-LD validation

For RDF-aware validators, the protocol vocabulary SHOULD ship a SHACL shapes graph alongside the `@context`. That is deferred; v1 implementers rely on the JSON Schemas above for input-side validation and the JSON-LD context document for term mapping.

---

## Appendix C — Publisher Helper Pseudocode

### C.1 jsonLdTypes()

```typescript
function jsonLdTypes(content: ContentSpec): string[] {
  const base = ['swarm-cat:CatalogItem'];
  switch (content.type) {
    case 'image':
      return [...base, 'sc:ImageObject'];
    case 'video':
      return [...base, 'sc:VideoObject'];
    case 'audio':
      return [...base, 'sc:AudioObject'];
    case 'text':
      return [...base, 'sc:TextDigitalDocument'];
    case 'document':
      return [...base, 'sc:CreativeWork'];
    case 'dataset':
      return [...base, 'cr:Dataset', 'sc:Dataset'];
    case 'bytes':
      return [...base, 'sc:MediaObject'];
  }
}
```

### C.2 buildInlineHeaders()

```typescript
function buildInlineHeaders(item: CatalogItem): Record<string, string> {
  const primaryPayment = item.payment[0];
  return {
    'swarm-cat:name': item.name,
    'swarm-cat:contentType': item.content.type,
    'swarm-cat:encodingFormat': item.content.encodingFormat,
    'swarm-cat:priceMinor': primaryPayment.amount,
    'swarm-cat:priceAsset': primaryPayment.asset,
    'swarm-cat:tags': (item.tags ?? []).join(','),
    'swarm-cat:dateAdded': item.dateAdded,
    'swarm-cat:version': item.version ?? '',
    'swarm-cat:lifecycle': item.lifecycle,
  };
}
```

### C.3 buildJsonLdLeaf()

```typescript
function buildJsonLdLeaf(item: CatalogItem): Record<string, unknown> {
  const content = item.content;
  const contentFields = mapContentToSchemaOrg(content);
  return {
    '@context': 'https://swarm-ai-catalog.eth/v1',
    '@type': jsonLdTypes(content),
    id: item.id,
    name: item.name,
    description: item.description,
    license: item.license,
    storage: {
      '@type': 'swarm-cat:SwarmStorage',
      reference: item.storage.reference,
      ...(item.storage.contentSize !== undefined ? { contentSize: item.storage.contentSize } : {}),
    },
    payment: item.payment.map((p) => ({
      '@type': 'swarm-cat:PaymentRequirements',
      scheme: p.scheme,
      chainId: p.chainId,
      asset: p.asset,
      amount: p.amount,
      payTo: p.payTo,
      ...(p.facilitator ? { facilitator: p.facilitator } : {}),
    })),
    ...(item.sample ? { sample: { '@type': 'swarm-cat:SampleSpec', ...item.sample } } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(item.version ? { version: item.version } : {}),
    lifecycle: item.lifecycle,
    ...(item.supersededBy ? { supersededBy: item.supersededBy } : {}),
    dateAdded: item.dateAdded,
    dateModified: item.dateModified,
    ...contentFields,
  };
}

function mapContentToSchemaOrg(c: ContentSpec): Record<string, unknown> {
  // Field-by-field projection from ContentSpec into schema.org-aligned keys.
  // schema.org fields are bare names (resolved by @context); swarm-cat:
  // extensions get explicit prefixes.
  switch (c.type) {
    case 'image':
      return {
        encodingFormat: c.encodingFormat,
        width: c.width,
        height: c.height,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.colorSpace ? { 'swarm-cat:colorSpace': c.colorSpace } : {}),
      };
    case 'video':
      return {
        encodingFormat: c.encodingFormat,
        width: c.width,
        height: c.height,
        duration: c.duration,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.bitrate !== undefined ? { bitrate: c.bitrate } : {}),
        ...(c.fps !== undefined ? { 'swarm-cat:fps': c.fps } : {}),
        ...(c.codec ? { 'swarm-cat:codec': c.codec } : {}),
        ...(c.hasAudio !== undefined ? { 'swarm-cat:hasAudio': c.hasAudio } : {}),
      };
    case 'audio':
      return {
        encodingFormat: c.encodingFormat,
        duration: c.duration,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.bitrate !== undefined ? { bitrate: c.bitrate } : {}),
        ...(c.codec ? { 'swarm-cat:codec': c.codec } : {}),
        ...(c.channels !== undefined ? { 'swarm-cat:channels': c.channels } : {}),
        ...(c.sampleRate !== undefined ? { 'swarm-cat:sampleRate': c.sampleRate } : {}),
      };
    case 'text':
    case 'document':
      return {
        encodingFormat: c.encodingFormat,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.wordCount !== undefined ? { wordCount: c.wordCount } : {}),
        ...(c.inLanguage ? { inLanguage: c.inLanguage } : {}),
      };
    case 'dataset':
      return {
        encodingFormat: c.encodingFormat,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.recordSets
          ? {
              'cr:conformsTo': 'http://mlcommons.org/croissant/1.1',
              'cr:recordSet': c.recordSets.map((rs) => ({
                '@type': 'cr:RecordSet',
                name: rs.name,
                field: rs.fields.map((f) => ({
                  '@type': 'cr:Field',
                  name: f.name,
                  dataType: f.dataType,
                })),
              })),
            }
          : {}),
        ...(c.isMultiFile !== undefined ? { 'swarm-cat:isMultiFile': c.isMultiFile } : {}),
      };
    case 'bytes':
      return {
        encodingFormat: c.encodingFormat,
        ...(c.contentSize !== undefined ? { contentSize: c.contentSize } : {}),
        ...(c.modelArchitecture ? { 'swarm-cat:modelArchitecture': c.modelArchitecture } : {}),
        ...(c.parameters !== undefined ? { 'swarm-cat:parameters': c.parameters } : {}),
      };
  }
}
```

---

## Appendix D — Hackweek POC Migration Notes

The Hackweek v1 prototype (LangGraph agents + Express x402 service + catalog feed browser) currently uses a single catalog-feed-as-JSON shape and a flat `AssetSpec` model. Migration to this v1 spec involves the following steps. None of them require breaking the Hackweek demo flows; they re-shape the on-Swarm representation.

1. **Switch catalog feed payload from JSON to bare Mantaray root.** Hackweek currently puts a JSON object on the feed. v1 puts the 64-char reference directly. Update the catalog feed reader and writer.
2. **Introduce per-item state feeds.** Hackweek combines purchase state inline with the catalog. v1 splits state into per-item feeds (§4.2, §14). Migration: on first publish under v1, initialize one state feed per existing item; on subsequent purchases, write to state feed instead of mutating the catalog.
3. **Add per-item directories.** Hackweek puts everything in catalog JSON. v1 uses `/items/{itemId}/item.jsonld` plus a `sample/` subdirectory. Migration: re-upload each item's content + sample under the new Mantaray layout.
4. **Rename `AssetSpec` fields to schema.org-aligned names.** `widthPx`→`width`, `heightPx`→`height`, `mimeType`→`encodingFormat`, `sizeBytes`→`contentSize`, `durationSeconds`→`duration` (ISO 8601 duration string), `language`→`inLanguage`, etc. (See §6.3 + Appendix A.1.)
5. **Drop the `publisher` field on catalog and item documents.** Hackweek may have included a `publisher` attribution on either `/catalog.jsonld` or `item.jsonld`. v1 removes it; agent attribution is performed by indexers walking from Agent Cards (§16.2). Migration: strip `publisher` blocks from leaves at re-upload time; ensure the catalog feed owner address is published in the Agent Card's `"swarm-ai-catalog"` services entry so indexers can pivot from agent to catalog.
6. **Add Croissant for tabular items.** Hackweek datasets had ad-hoc schemas. v1 uses Croissant 1.1 record sets. Migration: emit a `cr:recordSet` for each dataset.
7. **Adopt `PurchaseIntent` for purchase flow.** Hackweek may have used a simpler payment-intent shape. v1 requires the EIP-712 envelope binding `granteePublicKey`. Migration: client and server both upgrade — clients sign EIP-712, server verifies.
8. **Re-key inline metadata.** Hackweek's list view may have synthesized list metadata server-side. v1 expects publisher to attach inline metadata on Mantaray forks (§5.5). Migration: builder writes inline metadata at publish time.
9. **Remove catalog-rendering API.** Hackweek's `/v1/catalog` likely returns a synthesized list. v1 mandates it (if it exists at all) returns only the bare Mantaray root reference. Migration: convert clients to walk the Mantaray themselves; optionally retain the synthesized list under a non-canonical path (`/v1/catalog-rendered`) explicitly marked as a development helper.
10. **Confirm the ENS name.** Replace `swarm-ai-catalog.eth` with the registered ENS name once finalized. Update the `@context` IRI everywhere.
11. **Reframe state-feed access patterns.** Hackweek may have used the per-item state feed as a consumer subscription channel for content updates or popularity. v1 treats state feeds as publisher-owned ACT-state records; consumer reads are verification-only. Migration: in Bazaar and any consumer UI, stop polling state feeds for popularity/lifecycle changes and read those from the catalog Mantaray instead. Keep state-feed reads only for two explicit use cases: refreshing a stale `actHistoryRef` and auditing publisher claims.

---

_End of document._
