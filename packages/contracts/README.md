# @solarpunk/contracts

Per-seller **revenue splitter** contracts and their TypeScript SDK. The splitter is the address a
listing's x402 `payTo` points at: a purchase settles into it in full and is released fractionally
later — `(1 - t)` to the seller, `t` to the marketplace treasury.

Design source: `documents/data-enriched-marketplaces.md`, Step 4b.

## Why it exists

Collecting the sales tax at the destination rather than in the payment path keeps the marketplace
**non-custodial** — it never holds anyone's funds and never sits between buyer and seller. More
importantly it makes the tax **enforceable**: a sale that bypasses the split contract cannot be
taxed, but it also produces no valid Proof-of-Purchase, so it earns the seller no review
eligibility and no reputation. Sellers self-select into taxation for exactly the transactions they
want credited.

## Contracts

| Contract          | Role                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RevenueSplitter` | Clone target. `(seller, treasury, taxBps)` frozen by a one-shot `initialize`. `distribute(token)` sweeps its own balance for that token.       |
| `SplitterFactory` | Deploys one EIP-1167 clone per seller via CREATE2, `salt = keccak256(seller)`. Owns the treasury address and default rate for _future_ clones. |

Two properties the rest of the system depends on:

- **Counterfactual `payTo`.** Clone addresses are deterministic, so a publisher can compute a
  seller's `payTo` with `predictSplitter` and publish a catalog before the clone is deployed. An
  x402 `exact` settlement is an ERC-3009 `transferWithAuthorization` — a plain balance move with
  no callback — so funds land at the address whether or not code is there. Deployment is only
  needed before the first `distribute`.
- **Frozen terms.** A buyer signs an EIP-712 `PurchaseIntent` over the exact `payTo`. If a clone's
  seller or rate could change afterwards, that signature could be redirected. Changing terms means
  a new clone and a republished catalog entry — `setTreasury` / `setDefaultTaxBps` affect only
  clones created after the call.

Accounting is balance-based: entitlement is derived from the contract's own balance at
distribution time, never tracked per sale. That is what makes it work for any ERC-20 (USDC, BZZ,
any decimals) with no per-sale bookkeeping, and why `distribute` needs no special buyer behaviour.
Integer division rounds the treasury down, so sub-unit dust falls to the seller and the two shares
always sum to exactly the balance.

`MAX_TAX_BPS` (2000 = 20%) is a hard ceiling enforced in `initialize`, so a misconfigured factory
can never mint a clone that swallows a seller's proceeds.

## Toolchain

Foundry is **not** a pnpm dependency — install it separately:

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # https://getfoundry.sh
cd packages/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
```

Scripts route through `scripts/forge.mjs`, which **skips** with a warning when `forge` is absent so
root-level `pnpm test` / `pnpm build` still work for TypeScript-only contributors. Set
`REQUIRE_FOUNDRY=1` in CI to turn that skip into a hard failure.

```bash
pnpm --filter @solarpunk/contracts test           # forge test
pnpm --filter @solarpunk/contracts test:contracts # forge test -vvv
pnpm --filter @solarpunk/contracts build:abis     # forge build + regenerate ts/abis.ts
pnpm --filter @solarpunk/contracts build          # tsc (TypeScript SDK only)
```

`ts/abis.ts` is generated but **committed**, so downstream packages build without Foundry
installed. Regenerate it whenever the Solidity changes.

## Deploy

```bash
PRIVATE_KEY=0x... TREASURY_ADDRESS=0x... DEFAULT_TAX_BPS=500 \
  forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org --broadcast --verify
```

Writes `deployments/<DEPLOYMENT_NAME>.json` (default `base-sepolia`). Copy the factory address into
`SPLITTER_FACTORY_ADDRESS` (swarm-market-mcp) and record it in `ts/addresses.ts`.

## TypeScript SDK

```ts
import { predictSplitter, ensureSplitter, splitterTerms, distribute } from '@solarpunk/contracts';

const payTo = await predictSplitter(publicClient, factory, seller); // no tx — safe to publish
const { splitter, deployed } = await ensureSplitter(publicClient, walletClient, factory, seller);
const { treasury, taxBps } = await splitterTerms(publicClient, splitter);
await distribute(walletClient, splitter, usdcAddress); // permissionless
```

viem-based, since `x402-swarm-server` and `catalogue-feed-browser` already use viem. The raw ABIs
are exported too, for ethers consumers such as `erc8004-adapter`.

## Consumers

- **`swarm-market-mcp`** — `ensure_split_contract` resolves the address; `build_catalog` fills
  `payment[].payTo` with it and rejects a listing that names anything else.
- **`x402-swarm-server`** — `SPLITTER_ADDRESS` pins the accepted settlement destination
  (`payment_destination_untaxed` otherwise), and each purchase record stores its `pay_to`.
