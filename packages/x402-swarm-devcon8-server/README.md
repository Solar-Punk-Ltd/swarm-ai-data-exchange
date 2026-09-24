# x402-swarm-devcon8-server

The Devcon8 voucher variant of [`x402-swarm-server`](../x402-swarm-server/): the same
x402-gated purchase endpoint (`POST /v1/items/:itemId/purchase`, 402 challenge → signed
PurchaseIntent → facilitator verify/settle → ACT grant), plus one thing the generic server
deliberately does not do — **fulfillment**.

On every settled purchase this server:

1. mints a fresh Gnosis wallet **in memory** (`src/voucher.ts`),
2. records the **address** (never the key) in sqlite, keyed on the settlement tx — the
   double-fund guard and the operator's ledger of `funded=0` rows to top up by hand,
3. funds it with `GIFT_XBZZ_AMOUNT` xBZZ + `GIFT_XDAI_AMOUNT` xDAI (two plain transfers,
   serialized behind an in-process mutex so concurrent settlements never race the funder's
   nonces; xBZZ is 16 decimals),
4. returns the private key in the response's `data` field (a JSON string:
   `{type: "devcon8-voucher", address, privateKey, funded, fundTx}`), which
   `swarm-market-mcp`'s `purchase_catalog_item` passes through to the buyer agent.

**The private key is stored nowhere, at any layer.** A crash between funding and response
strands that wallet's funds forever; a lost response cannot be re-delivered (a duplicate
settle returns the address with a note, never a key). Both are accepted trades.

A funding failure after settlement still returns the key with `funded: false` — the payment
already cleared, so the visitor keeps the key and the operator tops up the recorded address.

## Configuration

Everything the generic server takes (see `.env.example`), plus the required `GIFT_FUNDER_PK`
and its `GIFT_*` companions. **`GIFT_FUNDER_PK` moves real xBZZ and xDAI on Gnosis mainnet**
— it is the only real-value key in the fleet and must never be the Base Sepolia test funder.
The server refuses to start without it.

Deployed by `agent-factory` via `docker/x402-devcon8.Dockerfile` for sellers stamped from the
`devcon` template; generic sellers keep the untouched `x402-swarm-server`.

## Divergence note

This package is a copy of `x402-swarm-server` (verification, catalog lookup, ACT grant,
state-feed retry are identical) and can drift from it. When the generic server takes a fix,
check whether it applies here too.
