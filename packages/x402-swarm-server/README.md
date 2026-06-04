# @solarpunk/x402-swarm-server

Publisher-side HTTP server for the [Swarm AI Data Exchange](../../README.md). It exposes a single
x402-gated purchase endpoint that verifies a buyer's signed `PurchaseIntent`, settles the on-chain
micropayment through an x402 facilitator, grants the buyer ACT (Access Control Trie) access to the
priced Swarm content, and advances the item's state feed.

## Concepts

- **itemId** — the priced content's Swarm reference (64-char hex). The content address _is_ the
  item identifier.
- **Catalog feed** — a Swarm feed whose payload is the bare Mantaray root reference of the catalog.
  Owned by `CATALOG_FEED_OWNER`; traversing its Mantaray locates each item's `item.jsonld`.
- **Per-item state feed** — a separate feed holding the item's `CatalogItemState` (ACT history
  reference, grantee-list reference, lifecycle). It advances on each grant and is verification-only.
- **ACT (Access Control Trie)** — Swarm's access-control mechanism. All priced content is
  ACT-protected; granting access means adding the buyer's Bee-node public key to the item's grantee
  list, which advances the ACT history reference.
- **PurchaseIntent** — an EIP-712 typed-data message the buyer signs, co-bundled with an ERC-3009
  payment authorization, proving they intend to buy a specific item at a specific price.

## The purchase endpoint

```
POST /v1/items/:itemId/purchase
```

`:itemId` is the priced content's 64-char hex Swarm reference. The endpoint is a single route that
behaves differently depending on whether the request carries an `X-Payment` header — the standard
x402 three-phase flow.

### Phase 1 — challenge (no `X-Payment` header)

1. Look up the item in the catalog (Mantaray traversal from the catalog feed root). A missing,
   retired, or non-purchasable item short-circuits with an `ApiError` before any payment logic runs.
2. Return **`402 Payment Required`** with an x402 v1 challenge body. The `accepts` entry is built
   from the item's advertised payment requirements, and `extra.purchaseIntentDomain` carries the
   EIP-712 domain the buyer must sign against:

   ```json
   {
     "name": "Swarm AI Data Exchange",
     "version": "1",
     "chainId": 84532,
     "verifyingContract": "0x…"
   }
   ```

### Phase 2 — fulfilment (`X-Payment` header present)

The header is a base64-encoded `PurchaseIntent` envelope (intent + ERC-3009 authorization). The
server runs the following verification steps in order:

| Step | Action                                                                           | Failure code                              |
| ---- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| 1    | Decode the base64 `X-Payment` header into a `PurchasePayload`                    | `intent_malformed`                        |
| —    | Co-signing invariant: intent message and authorization describe the same payment | `intent_malformed`                        |
| 2    | Recover the EIP-712 signer and confirm it is the payer EOA                       | `intent_signature_invalid`                |
| 3    | Domain match (verifying contract + advertised chain id)                          | `intent_domain_mismatch`                  |
| 4    | Item match (intent `itemId` == path `itemId`)                                    | `intent_item_mismatch`                    |
| 5    | Payment match against the item's advertised accepts entries                      | `intent_payment_mismatch`                 |
| 6    | Time window (`validAfter` / `validBefore`)                                       | `intent_not_yet_valid` / `intent_expired` |
| 7    | Nonce freshness (read-only)                                                      | `intent_replay`                           |
| 8    | Facilitator `POST /verify`                                                       | `payment_verify_failed`                   |
| 9    | Facilitator `POST /settle` — **point of no return**                              | `payment_settle_failed`                   |
| —    | Record nonce + purchase **between settle and grant**                             | —                                         |
| 10   | ACT grant: add the buyer's Bee-node public key to the item's grantee list        | `act_grant_failed`                        |
| 11   | Advance the per-item state feed with the new ACT refs (non-fatal)                | `state_feed_failed`                       |
| 12   | Return **`200 OK`** with the `ActGrantResult`                                    | —                                         |

Steps 1–8 are reversible: any failure returns a structured `ApiError` and leaves no state behind.
Once `/settle` succeeds (step 9) the purchase record is persisted **before** the ACT grant, so the
record is never lost even if the grant fails. Step 11 is best-effort — a failed state-feed write is
logged but still returns `200`, because the buyer has already paid and been granted access.

## Error responses

All failures emit the `ApiError` envelope:

```json
{ "error": "intent_replay", "message": "…", "details": { … }, "retryable": false }
```

Code → HTTP status / retryable mapping (see `src/errors.ts`):

| Code                       | Status | Retryable |
| -------------------------- | ------ | --------- |
| `item_not_found`           | 404    | no        |
| `item_retired`             | 410    | no        |
| `item_not_purchasable`     | 404    | no        |
| `intent_malformed`         | 400    | no        |
| `intent_signature_invalid` | 400    | no        |
| `intent_domain_mismatch`   | 400    | no        |
| `intent_item_mismatch`     | 400    | no        |
| `intent_payment_mismatch`  | 400    | no        |
| `intent_expired`           | 400    | no        |
| `intent_not_yet_valid`     | 400    | yes       |
| `intent_replay`            | 409    | no        |
| `payment_verify_failed`    | 402    | no        |
| `payment_settle_failed`    | 502    | yes       |
| `act_grant_failed`         | 500    | yes       |
| `state_feed_failed`        | 500    | no        |
| `internal_error`           | 500    | yes       |

## Module layout

| File                 | Responsibility                                                              |
| -------------------- | --------------------------------------------------------------------------- |
| `src/config.ts`      | Load + validate env into `ServerConfig`; `parseChainId` (CAIP-2 → numeric)  |
| `src/errors.ts`      | `ErrorCode` catalog, `PurchaseError`, `ApiError` serialization, `sendError` |
| `src/db.ts`          | `Store` over better-sqlite3: nonce store + purchase records (WAL)           |
| `src/facilitator.ts` | `FacilitatorClient` (`/verify`, `/settle`); CAIP-19 → token address         |
| `src/intent.ts`      | `decodeXPayment` + `verifyPurchaseIntent` (verification steps 1–7)          |
| `src/catalog.ts`     | `lookupItem`: catalog feed → Mantaray → item.jsonld + state feed            |
| `src/act.ts`         | `grantActAccess`: `bee.patchGrantees` ACT grant (step 10)                   |
| `src/purchase.ts`    | `buildChallenge` + `purchaseHandler` orchestration                          |
| `src/index.ts`       | Express wiring: config, Bee, Store, facilitator, route, listen              |

## Storage

A single SQLite file (`DB_PATH`, default `./data/store.db`) holds two tables:

- `nonces` — burned PurchaseIntent nonces, enforcing replay protection (step 7 reads, step 9 writes).
- `purchases` — `(consumer_address, item_id, tx_hash, settled_at)`, written between settle and grant.

## Configuration

Copy `.env.example` → `.env` and fill in:

| Variable                          | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `PORT`                            | HTTP listen port (default `3000`)                                  |
| `PAYMENT_ADDRESS`                 | EVM address that receives x402 payments                            |
| `NETWORK`                         | CAIP-2 network id, e.g. `eip155:84532`                             |
| `FACILITATOR_URL`                 | x402 facilitator endpoint (default `https://x402.org/facilitator`) |
| `PURCHASE_INTENT_DOMAIN_CONTRACT` | `verifyingContract` for the EIP-712 `PurchaseIntent` domain        |
| `BEE_API_URL`                     | Bee node endpoint (default `http://localhost:1633`)                |
| `POSTAGE_BATCH_ID`                | Postage stamp batch for ACT grant + state-feed writes              |
| `CATALOG_FEED_OWNER`              | EOA address of the catalog feed signer (locates the catalog)       |
| `ITEM_STATE_FEED_PK`              | Per-item state feed signer private key (hot key)                   |
| `DB_PATH`                         | SQLite file path (default `./data/store.db`)                       |

## Develop, run, test

From the monorepo root:

```bash
pnpm install                                   # install workspace deps
pnpm --filter @solarpunk/x402-swarm-server dev    # run with tsx (no build step)
pnpm --filter @solarpunk/x402-swarm-server build  # tsc → dist/
pnpm --filter @solarpunk/x402-swarm-server test   # jest unit tests
```

A local Bee node at `http://localhost:1633` (light node is fine) is required for live purchase flows.

## Notes / deviations from CLAUDE.md

- **better-sqlite3 is `^12.2.0`**, not the spec's `^9.0.0`. v9 has no prebuilt binaries for current
  Node and failed to compile from source without a C++ toolchain; v12 ships a working prebuild.
- **The flow is implemented manually, not via `@x402/express` `paymentMiddleware`.** The standard
  middleware cannot emit the custom 402 challenge (`extra.purchaseIntentDomain`) or run the
  PurchaseIntent EIP-712 verification, so the server drives the three-phase / 12-step flow itself
  and talks to the facilitator over plain HTTP through `FacilitatorClient`.
