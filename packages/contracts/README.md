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

| Contract          | Role                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RevenueSplitter` | Clone target. `(seller, treasury, taxBps)` frozen by a one-shot `initialize`. `distribute(token)` sweeps its own balance for that token.                                                      |
| `SplitterFactory` | Deploys one EIP-1167 clone per seller and records it in `splitterOf`. Owns the treasury address and default rate for _future_ clones, keeps the clone registry, and batches sweeps across it. |

Two properties the rest of the system depends on:

- **The clone exists before the listing does.** A seller deploys their own clone with
  `createSplitter` and only then publishes a catalog against it, so the seller pays that gas
  rather than the operator who later runs a sweep. `splitterOf[seller]` is the single source of
  truth for `payTo` — the address is an ordinary CREATE address and cannot be derived off-chain,
  which also makes the mapping the only thing keeping a seller's clone unique.
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

## Collecting

Nothing is pushed. A settlement lands in the seller's clone in full and stays there until someone
calls `distribute(token)` on it, which releases `taxBps` to the treasury and the rest to the
seller. That call is permissionless by design: a sweep can only move funds to the two addresses
frozen at clone creation, so the seller never depends on the marketplace to be paid, and the
marketplace never depends on the seller.

For the operator, `SplitterFactory` collects across every seller in one transaction:

| Call                                   | Use                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `distributeAll(token, offset, limit)`  | Sweep a token out of every clone in the registry window. `limit = type(uint256).max` = all. |
| `distributeFor(splitters[], token)`    | Sweep an explicit list — for a keeper that already knows which clones hold a balance.       |
| `splitterCount()` / `splittersSlice()` | Read the registry to size or paginate a sweep, without replaying `SplitterCreated` logs.    |

Both batch calls return `(swept, skipped)`. A clone that reverts — a token blacklisting the
seller, say — is skipped and logged as `DistributeSkipped`, never allowed to abort the batch and
hold everyone else's payout hostage. An idle clone is a no-op, not a failure, so a sweep does not
have to pre-filter.

The loop is one external call per clone with no gas ceiling, so `distributeAll` is a paginated
call, not an unbounded one: once the registry grows past what fits in a block, sweep it in pages.

`distributeAll` covers every clone in the registry, and since a seller cannot list without one,
that is every seller who has published. `distributeFor` takes caller-supplied addresses instead,
so it also screens each target for code — an EOA or any non-splitter address is counted as
skipped rather than aborting the batch.

One consequence of frozen terms worth planning for: `setTreasury` only redirects _future_ clones.
Rotating the treasury leaves every existing clone paying the old address, which must stay live to
collect from pre-rotation sellers.

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
import {
  splitterOf,
  ensureSplitter,
  splitterTerms,
  distribute,
  distributeAll,
} from '@solarpunk/contracts';

const payTo = await splitterOf(publicClient, factory, seller); // undefined until deployed
const { splitter, deployed } = await ensureSplitter(publicClient, walletClient, factory, seller);
const { treasury, taxBps } = await splitterTerms(publicClient, splitter);
await distribute(walletClient, splitter, usdcAddress); // one seller; permissionless
await distributeAll(walletClient, factory, usdcAddress); // every seller, one tx
```

viem-based, since `x402-swarm-server` and `catalogue-feed-browser` already use viem. The raw ABIs
are exported too, for ethers consumers such as `erc8004-adapter`.

## Consumers

- **`swarm-market-mcp`** — `create_split_contract` deploys the seller's clone and
  `get_split_contract` reads it back; `build_catalog` fills `payment[].payTo` with it, and fails
  outright if the seller has no clone or names anything else.
- **`x402-swarm-server`** — `SPLITTER_ADDRESS` pins the accepted settlement destination
  (`payment_destination_untaxed` otherwise), and each purchase record stores its `pay_to`.
