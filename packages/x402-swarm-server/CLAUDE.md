# x402-swarm-server

Publisher HTTP server: x402-gated purchase endpoint, ACT grant issuance, per-item state feed writes, purchase record store.

## Spec reference

`../../documents/swarm-ai-catalog-design-v1_2026-05-26-final.md`

Read before implementing:

- Part 10 — HTTP API (purchase endpoint, three-phase flow)
- Part 11 — PurchaseIntent EIP-712 format and 11-step server verification
- Part 14 — Per-item state feed write flow (post-grant)
- Part 15 — Error handling (ApiError envelope + full error code catalog)

## What is changing and why

| Current                                 | Required                                       |
| --------------------------------------- | ---------------------------------------------- |
| `GET /swarm/data/:swarmHash`            | `POST /v1/items/:itemId/purchase`              |
| `swarm-public-key` header for grantee   | `PurchaseIntent` EIP-712 in `X-Payment` header |
| Flat `SwarmMetadataCatalogue` JSON feed | Mantaray catalog lookup via `swarm-catalog`    |
| No nonce store                          | SQLite nonce store (replay prevention)         |
| No state feed write after grant         | State feed write at step 11                    |
| No purchase record                      | SQLite purchase record written at step 9       |
| Ad-hoc error responses                  | `ApiError` envelope with typed error codes     |

Keep the existing x402 middleware integration (`@x402/express`, `paymentMiddleware`) — its role doesn't change, but it now wraps the new endpoint.

## New endpoint

```
POST /v1/items/:itemId/purchase
Content-Type: application/json
Body: { "granteePublicKey": "0x04..." }
```

### Phase 1 — no `X-Payment` header

Return `402 Payment Required` with x402 challenge body. The `extra` block MUST include `purchaseIntentDomain` so the consumer can build a valid EIP-712 signature:

```json
{
  "x402Version": 1,
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "asset": "...",
      "maxAmountRequired": "...",
      "payTo": "...",
      "resource": "https://.../v1/items/:itemId/purchase",
      "extra": {
        "facilitator": "...",
        "purchaseIntentVersion": "1",
        "purchaseIntentDomain": {
          "name": "Swarm AI Data Exchange",
          "version": "1",
          "chainId": 84532,
          "verifyingContract": "0x..."
        }
      }
    }
  ]
}
```

### Phase 2 — with `X-Payment` header

Run the 11-step verification. See §11.5 for full details.

### Phase 3 — success

Return `200 OK` with `ActGrantResult` body (type from `swarm-catalog`).

## 12-step verification (§11.5)

Steps 1–8 are reversible (no state change on failure). Steps 9–11 are committing.

```
1. Parse + decode X-Payment header (base64 JSON)
   → 400 intent_malformed

2. Verify EIP-712 signature on PurchaseIntent.message
   → 400 intent_signature_invalid
   → recover consumerAddress here (needed for purchase record at step 9)

3. Check domain match (chainId + verifyingContract vs server config)
   → 400 intent_domain_mismatch

4. Check item match (message.itemId === path :itemId)
   → 400 intent_item_mismatch

5. Check payment match (message.payment consistent with item's PaymentRequirements)
   → 400 intent_payment_mismatch

6. Check time window (validAfter ≤ now ≤ validBefore)
   → 400 intent_expired / intent_not_yet_valid

7. Check nonce freshness (query nonce store)
   → 409 intent_replay
   → write nonce to store here

8. Facilitator /verify
   → 402 payment_verify_failed

── POINT OF NO RETURN ──

9. Facilitator /settle → txHash
   → 502 payment_settle_failed (retryable)
   → WRITE purchase record (consumerAddress, itemId, txHash, settledAt) HERE

10. ACT grant: bee.patchGrantees(itemRef, actHistoryRef, [granteePublicKey])
    → 500 act_grant_failed (retryable, publisher MUST retry)
    → capture new actHistoryRef + granteeRef

11. State feed write: update CatalogItemState via state.ts from swarm-catalog
    → log state_feed_failed but DO NOT fail the response (grant already issued)
    → publisher must retry state feed write in background

12. Return ActGrantResult
```

## Storage — SQLite (better-sqlite3)

Two tables in a single local DB file:

```sql
CREATE TABLE nonces (
  nonce     TEXT PRIMARY KEY,
  used_at   TEXT NOT NULL
);

CREATE TABLE purchases (
  consumer_address  TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  tx_hash           TEXT NOT NULL,
  settled_at        TEXT NOT NULL
);
CREATE INDEX purchases_item_id ON purchases(item_id);
CREATE INDEX purchases_consumer ON purchases(consumer_address);
```

`nonces`: written at step 7, prevents replay.
`purchases`: written at step 9 (after settle, before grant). Used by the indexer to cross-reference payment-verified feedback without relying on the consumer to attach the txHash when calling `postFeedback`.

## Catalog lookup

Replace `fetchCatalogue()` / `findDataItem()` with Mantaray-based lookup:

1. Read catalog feed `(owner=CATALOG_FEED_OWNER env, topic=CATALOG_FEED_TOPIC from swarm-catalog)` → Mantaray root reference
2. From Mantaray, fetch `/items/:itemId/item.jsonld`
3. Parse as `CatalogItem` (type from `swarm-catalog`)
4. If path not found → `404 item_not_found`
5. If `lifecycle === "retired"` → `410 item_retired`

## Error responses

All errors use `ApiError` envelope (§15.1):

```typescript
{ error: string, message: string, details?: Record<string, unknown>, retryable: boolean }
```

Full error code catalog is in §15.2 of the spec. Implement all codes.

## Environment variables

Extend existing env vars with:

```
CATALOG_FEED_OWNER      — EOA address of the catalog feed signer
ITEM_STATE_FEED_PK      — private key for per-item state feed signer (hot key)
PURCHASE_INTENT_DOMAIN_CONTRACT  — verifyingContract address for EIP-712 domain
DB_PATH                 — path to SQLite DB file (default: ./data/store.db)
```

## Prototype exclusions

Do NOT implement:

- `GET /v1/catalog` pass-through (§10.4)
- `GET /v1/state/:itemId` pass-through (§10.5)
- Recovery endpoint for `act_grant_failed` retry (§11.5)
- Background retry queue for failed state feed writes

## Dependencies

Add to existing:

```json
{
  "@solarpunk/swarm-catalog": "workspace:*",
  "better-sqlite3": "^9.0.0",
  "@types/better-sqlite3": "^7.0.0"
}
```
