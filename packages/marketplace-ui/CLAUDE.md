# marketplace-ui

Marketplace operator dashboard: a read-mostly view of the `SplitterFactory` registry showing the
treasury, every seller, every seller's `RevenueSplitter` clone, their balances, and a
**Distribute** action that sweeps a clone's accrued revenue to seller + treasury.

This is an **operator/demo surface**, not a consumer surface. It answers "who is selling, what has
accrued, and has it been paid out" — it does not browse catalogs, purchase, or touch Swarm. There
is no Bee dependency in this package.

## Source of truth

The contracts, not a spec document. Read before changing anything on-chain-facing:

- `../contracts/src/SplitterFactory.sol` — the registry (`_splitters`, `splitterOf`, pagination)
- `../contracts/src/RevenueSplitter.sol` — clone terms, `pending`, `distribute`, `distributeMany`
- `../contracts/ts/index.ts` — the viem SDK. **Every contract call in this package goes through
  it.** Do not re-declare ABIs or hand-roll `readContract` calls here. The one exception is ERC-20
  `balanceOf`, which uses viem's own `erc20Abi`. `factoryConfig()` was added to the SDK for this
  dashboard's treasury card — extend the SDK rather than reaching around it.

`documents/data-enriched-marketplaces.md` Step 4b is the design rationale for the split model.

## Tech stack

Mirrors `erc8004-dashboard` — Vite + React 18 + TypeScript, plain CSS, no UI framework — with one
deliberate divergence:

| Concern   | Choice                               | Why                                                                                              |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Bundler   | Vite 5                               | same as `erc8004-dashboard`                                                                      |
| UI        | React 18 + TypeScript 5.7            | same as `erc8004-dashboard`                                                                      |
| Chain lib | **viem** (not ethers v6)             | `@solarpunk/contracts` is viem-only; duplicating its ABIs in ethers is worse than diverging      |
| Styling   | CSS Modules over a shared token file | `erc8004-dashboard` uses inline styles with hardcoded hex; that does not scale to this many rows |
| Wallet    | raw EIP-1193 (`window.ethereum`)     | two write paths, no session state; wagmi/RainbowKit is not worth the dependency weight           |

Do not add wagmi, RainbowKit, ethers, Tailwind, or a component library. If a table needs more than
plain CSS Grid, the design is too complicated.

## Theme

`erc8004-dashboard` has no design tokens — the palette is hardcoded inline across `App.tsx` and
`components/`. Extract it here into `src/theme.ts` and use it everywhere; never inline a hex value.

| Token       | Value     | Source                                            |
| ----------- | --------- | ------------------------------------------------- |
| `bg`        | `#0b0d10` | `erc8004-dashboard/src/index.css` body background |
| `text`      | `#f1ede4` | body colour                                       |
| `accent`    | `#f5a524` | "Swarm AI" wordmark amber                         |
| `textMuted` | `#a9a397` | subtitle colour                                   |

Anything beyond those four (surface, border, success, danger) is new — derive it from the base
palette and add it to `theme.ts` with a comment saying it is a marketplace-ui addition, so the two
dashboards stay visually reconcilable.

Header must match the sibling dashboard: amber `Swarm AI` + cream `Data Exchange`, with the
subtitle changed to describe this view (e.g. "Marketplace treasury and seller revenue").

## Layout

```
TREASURY
  address (+ explorer link)   ETH balance   USDC balance   default tax rate
  [ DISTRIBUTE ALL ]   n clones funded · X.XX USDC pending

SELLERS  (one card/row per clone in the factory registry)
  seller address (+ explorer link)      ETH balance   USDC balance
  splitter address (+ explorer link)    USDC accrued (seller share / treasury share)   tax rate
  [ DISTRIBUTE ]
```

## Data flow

### Enumerating sellers — note the direction

**The factory has no seller list.** `splitterOf` is a one-way `seller => splitter` mapping with no
enumerable keyset (`SplitterFactory.sol:31`). The enumerable array is `_splitters`, exposed through
`splitterCount` / `splitterAt` / `splittersSlice` (`SplitterFactory.sol:37`), and it holds **clone**
addresses.

So the load order is inverted from the obvious one:

1. `splitterCount(client, factory)` → `splittersSlice(client, factory, 0n, MAX_UINT256)` → clone addresses
2. `splitterTerms(client, splitter)` per clone → `{ seller, treasury, taxBps }`

That gives you the `(seller, splitter, taxBps)` triple in one pass. **Do not then call
`splitterOf(seller)`** — it is a redundant round trip that returns the clone you already have.

`splittersSlice` clamps `limit` on-chain, so `MAX_UINT256` means "to the end" and is safe. It
reverts when `offset > length`, so do not paginate past `splitterCount`. Paginate for real once the
registry outgrows a single response; there is no need before that.

`SplitterCreated` (both args indexed) is available if incremental/timestamped updates are ever
wanted, but polling `splittersSlice` is simpler and has no log-retention or reorg bookkeeping. Use
the slice.

### Balances

| Address        | ETH                       | USDC            |
| -------------- | ------------------------- | --------------- |
| Treasury       | `eth_getBalance`          | `balanceOf`     |
| Seller EOA     | `eth_getBalance`          | `balanceOf`     |
| Splitter clone | **not shown — see below** | `pending(USDC)` |

Use `pending(client, splitter, token)` rather than a raw `balanceOf` for clones. Same cost, but it
returns `{ sellerAmount, treasuryAmount }`, so the row can show what the Distribute button will
actually pay out instead of an undifferentiated total.

### Refresh

Every `VITE_REFRESH_INTERVAL_MS` (default 5000), re-read all balances. The registry itself
(`splittersSlice` + `splitterTerms`) changes rarely — re-read it on a slower cadence or only on
mount plus post-transaction, not every tick.

**Batch the reads.** A naive tick is `3N + 3` RPC requests (N = sellers), and public Base Sepolia
rate-limits hard — `erc8004-dashboard/.env.example` already carries a warning about exactly this.
Construct the client with JSON-RPC batching so a whole tick is one HTTP round trip:

```typescript
createPublicClient({ chain, transport: http(rpcUrl, { batch: true }) });
```

This covers `eth_getBalance` too, which Multicall3 aggregation would not without explicitly calling
Multicall3's own `getEthBalance`. Prefer the transport batch; reach for `client.multicall` only if
the configured RPC rejects batched requests.

Also pause the interval when `document.hidden` — a backgrounded demo tab should not burn quota.

## Load-bearing constraints

### RevenueSplitter cannot hold or distribute ETH

`RevenueSplitter` has **no `receive()` or `fallback()`**, so a plain ETH transfer to a clone
reverts. Its ETH balance is structurally always zero. `distribute(address token)`
(`RevenueSplitter.sol:93`) is ERC-20 only, and `distributeMany(address[])` takes token addresses
with no native sentinel — passing `address(0)` reverts when the `balanceOf` return fails to decode.

Consequences, all mandatory:

- **Do not render an ETH balance on a splitter row.** It is always 0 and reads as a bug.
- **Do not include ETH in the Distribute call or in the button's enable condition.** Gate the
  button on the clone's ERC-20 balances alone.
- ETH balances on the **treasury** and **seller EOA** rows are correct and useful (that is gas) —
  keep those.

Adding native support would mean a new implementation contract → new factory → and existing clones
could not migrate (EIP-1167 clones are not upgradeable and their terms are frozen by
`initialize`). Every published `payTo` would need re-publishing, because the buyer signs an EIP-712
`PurchaseIntent` over the exact address. Out of scope. Do not attempt it from this package.

### `defaultTaxBps` is not what current sellers pay

`SplitterFactory.defaultTaxBps` is the rate applied to **clones created from now on**. Each clone
freezes its own `taxBps` at `initialize` (`RevenueSplitter.sol:64`) and it never changes, so an
existing seller's effective rate can legitimately differ from the factory default.

- Treasury section: label it **"Default rate (new sellers)"**, never "the tax rate".
- Seller rows: show that clone's own `taxBps` from `splitterTerms`.

Percentage is `bps / 100` (`BPS_DENOMINATOR` is 10_000, exported from `@solarpunk/contracts`). Do
not hardcode 10000.

### Terminology: clones, not proxies

They are EIP-1167 minimal clones. "Proxy" implies upgradeable, which is deliberately false here.
Label them "splitter" or "splitter clone" in UI copy and code.

### Distribute is permissionless

`distribute` / `distributeMany` can be called by anyone — a sweep can only move funds to the seller
and treasury addresses frozen at clone creation. So the button needs **no** ownership check and no
gating on which wallet is connected. Any connected wallet with gas works; that is by design, so a
seller never depends on the operator to reach their funds. See _Who pays for gas_ below for the
cost consequence of that.

### Who pays for gas

**The connected wallet pays for every distribution** — both the per-seller button and the batch
sweep. On this dashboard that wallet is the marketplace operator, so the operator pays to move
funds to each seller as well as into its own treasury.

That is deliberate, not an oversight. `SplitterFactory.sol:103-107` calls the batch sweep "the
marketplace operator's collection call" and notes that a third party invoking it "can do nothing
but pay the gas." It is the counterpart to the seller paying for their own clone deployment
(`swarm-market-mcp/src/splitter.ts:11`), which exists precisely so the operator does not absorb
that cost later at sweep time.

**Do not wire either button to require the seller's wallet.** Permissionless means the operator can
pay on the seller's behalf, and that is the point in both directions: a seller never depends on the
operator to reach their funds, and never has to hold gas in order to _receive_ revenue.

## Distribute flow

Two entry points, one shared transaction-lifecycle primitive. Both are paid by the connected
wallet — see _Who pays for gas_ above.

### Per-seller

1. Button is **disabled** when the clone's ERC-20 balances are all zero. `distribute` no-ops on a
   zero balance rather than reverting, so a stray click is harmless — but a disabled button is
   still the honest state.
2. On click, call `distributeMany(walletClient, splitter, tokens)` from `@solarpunk/contracts`,
   where `tokens` is every **ERC-20** entry in the currency config for the active chain (today:
   USDC alone; native entries are filtered out, per the ETH constraint above).
3. Surface the full transaction lifecycle in the row: `idle → awaiting signature → pending →
confirmed | failed`. Never leave the button in an indeterminate state — this is a presentation
   surface and a silently hanging button is the worst failure mode.
4. On confirmation, force an immediate balance refresh instead of waiting for the next tick.
5. Chain mismatch is a first-class state: if the wallet is not on `VITE_CHAIN_ID`, show a "Switch
   network" action (`wallet_switchEthereumChain`) rather than letting the send fail.

### Distribute All (batch)

N sellers means N transactions on the operator's wallet. The factory sweeps them in one instead, so
the treasury section gets a batch action.

**Use `distributeForMany`, not `distributeAll`.** `distributeAll(token, offset, limit)` walks every
clone in the registry including idle ones, but this dashboard already polls `pending` for every
clone every few seconds — it knows exactly which ones hold a balance. Passing only the funded
clones is strictly cheaper, and is the case the SDK doc comment describes
(`packages/contracts/ts/index.ts:158`): "for a keeper that has already used `pending` to find the
ones actually holding a balance and would rather not pay to walk idle clones."

1. **Enabled** when at least one clone has a non-zero ERC-20 balance. Label it with the funded-clone
   count and total pending, so the operator sees the scope before signing rather than after.
2. Call `distributeForMany(walletClient, factory, fundedSplitters, token)`, with `fundedSplitters`
   derived from the same `pending` reads that drive the seller rows. Both batch helpers take a
   **single token**, not an array — sweeping M ERC-20s is M transactions. With USDC as the only
   ERC-20 in the currency config today, that is one.
3. Fall back to `distributeAll(walletClient, factory, token, 0n, MAX_UINT256)` only when `pending`
   data is stale (the last poll failed), since the funded set cannot be trusted then. `limit` is
   clamped on-chain, so `MAX_UINT256` is a safe "to the end"; `offset > splitterCount` **reverts**,
   so never paginate past it.
4. **Partial success is normal and must be surfaced.** A clone that reverts is skipped rather than
   propagated (`SplitterFactory.sol:162-167`), so a batch can half-succeed. `writeContract` returns
   only a tx hash — the `(swept, skipped)` return values are not reachable that way. Get the counts
   by `simulateContract` before sending, or by counting `DistributeSkipped` logs in the receipt.
   Report "swept N, skipped M" and mark the skipped rows.
5. The tx state machine (`idle → awaiting signature → pending → confirmed | failed`) is the same one
   the per-seller button uses, but the batch drives **every** affected row into the pending state
   at once, not just one.
6. On confirmation, force an immediate refresh, as with the per-seller path.
7. Gas ceiling: the on-chain loop is one external call per clone with no bound. The batch must
   paginate once the registry is large enough to approach the block gas limit — not a concern at
   demo scale, but do not write code that assumes it never will be.

Reads must work with **no wallet connected at all**. Connection is required only to distribute.

## Currency config

Balances are config-driven, not hardcoded. `src/config/currencies.ts`, keyed by chain id:

```typescript
export interface Currency {
  symbol: string;
  decimals: number;
  /** Undefined for the chain's native currency; an ERC-20 address otherwise. */
  address?: `0x${string}`;
}

export const CURRENCIES: Record<number, Currency[]> = {
  84532: [
    { symbol: 'ETH', decimals: 18 },
    { symbol: 'USDC', decimals: 6, address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  ],
};
```

`decimals` is load-bearing — USDC is 6 and ETH is 18, and formatting one with the other's decimals
is the classic silent bug here. Format with viem's `formatUnits`, never manual division.

The `address?` field is the native/ERC-20 discriminator. The Distribute call filters on it; the
splitter row filters on it (native entries are dropped entirely).

## Environment variables

All are Vite build-time vars and **must** carry the `VITE_` prefix — Vite exposes nothing else to
the browser. All values here are public; there is no secret in this package.

| Variable                        | Required | Default                    | Purpose                                                      |
| ------------------------------- | -------- | -------------------------- | ------------------------------------------------------------ |
| `VITE_TREASURY_ADDRESS`         | yes      | —                          | Marketplace treasury shown in the Treasury section           |
| `VITE_SPLITTER_FACTORY_ADDRESS` | yes      | —                          | `SplitterFactory` to enumerate                               |
| `VITE_CHAIN_ID`                 | no       | `84532`                    | Base Sepolia. Selects the viem chain and the currency config |
| `VITE_RPC_URL`                  | no       | `https://sepolia.base.org` | **Required in practice** — the public node rate-limits       |
| `VITE_REFRESH_INTERVAL_MS`      | no       | `5000`                     | Balance poll interval                                        |

`VITE_RPC_URL` is not in the original spec for this dashboard but is not optional in reality:
`VITE_CHAIN_ID` selects a chain, it does not provide a transport. Mirror the wording of
`erc8004-dashboard/.env.example`, which already documents the rate-limit failure mode.

Validate all of it once at startup in `src/config/env.ts` and fail loudly with a readable message.
A dashboard that renders empty because `VITE_TREASURY_ADDRESS` was unset is worse than one that
refuses to boot.

## Explorer links

Do not hardcode `sepolia.basescan.org` — the chain is configurable, so the explorer must be too.
Derive it from the viem chain (`chain.blockExplorers.default.url`) and build
`${explorer}/address/${address}`. Every address in the UI (treasury, seller, clone) gets the same
external-link affordance: `target="_blank"`, `rel="noopener noreferrer"`.

## Package layout

Mirror `erc8004-dashboard` so someone who knows one knows the other:

```
src/
  main.tsx                  — createRoot + <App />, and applyTheme() before first paint
  App.tsx                   — page shell, header, <TreasurySection /> + <SellerSection />
  theme.ts                  — colour tokens + applyTheme() (see Theme above)
  index.css                 — reset + body, matching erc8004-dashboard/src/index.css
  config/
    env.ts                  — parse + validate import.meta.env; exports `config` or `configError`
    currencies.ts           — CURRENCIES by chain id, plus the erc20Currencies() filter
    chain.ts                — viem chain object + explorer address/tx URL builders
  context/
    MarketplaceContext.tsx  — registry + balances + polling; the single fetch owner
    WalletContext.tsx       — EIP-1193 connect / account / chain id / switch chain
  lib/
    reads.ts                — every on-chain read: loadRegistry, readBalances, isFunded
    format.ts               — formatTaxBps (via the SDK BPS_DENOMINATOR), formatAge
  hooks/
    usePolling.ts           — interval + document.hidden pause
    useTxLifecycle.ts       — shared idle/signing/pending/confirmed state machine
    useDistribute.ts        — one clone; wraps useTxLifecycle
    useDistributeAll.ts     — batch sweep; wraps the same useTxLifecycle
  components/
    styles.module.css       — shared CSS module for every component
    TreasurySection.tsx
    SellerSection.tsx
    SellerRow.tsx
    AddressLink.tsx         — address + copy + explorer icon; used by every section
    Balance.tsx             — formatUnits + symbol, with a skeleton state
    TxNote.tsx              — renders the tx state machine; shared by both buttons
    DistributeButton.tsx
    DistributeAllButton.tsx — treasury-level batch sweep
    ConnectButton.tsx
```

The reads live in `lib/`, not `hooks/`, on purpose: they are plain async functions, and a
`useBalances` hook would invite rows to call it and quietly break the single-fetch-owner rule.

One context owns all fetching. Do not let individual rows poll independently — that is how `3N`
requests become `3N` uncoordinated timers.

## Vite config

Copy `erc8004-dashboard/vite.config.ts` and adjust:

- Alias `@solarpunk/contracts` → `../contracts/ts/index.ts`, so the app runs against source with no
  build step (the same trick the sibling uses for `erc8004-adapter`).
- `server: { port: 5174 }` — `erc8004-dashboard` occupies the default 5173, and root `pnpm dev`
  runs every package in parallel.
- No `@ethersphere/bee-js` externalization and no `dotenv` mock are needed; this package touches
  neither.

## package.json

```json
{
  "name": "@solarpunk/marketplace-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview"
  },
  "dependencies": {
    "@solarpunk/contracts": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "viem": "^2.21.0"
  }
}
```

Match `erc8004-dashboard`'s devDependencies exactly (`@types/react`, `@types/react-dom`,
`@vitejs/plugin-react`, `typescript`, `vite`) so the two stay on one toolchain.

## Presentation polish

This is built to be demoed. The states that get skipped and then bite on stage:

- **Loading** — skeleton rows on first load, never a flash of zeros. A real zero and an unloaded
  value must never look the same.
- **Empty registry** — `splitterCount === 0` is the normal state on a fresh factory. Say so
  ("No sellers have deployed a splitter yet"), do not render an empty table.
- **RPC failure** — a failed tick must not blank the table. Keep the last good values, mark them
  stale, and show the error out of the way.
- **Address rendering** — truncate as `0x1234…abcd` with the full value in `title`, and make it
  copyable. Never wrap a full address mid-row.
- **Partial batch failure** — after a sweep that reports skips, a skipped row must be visually
  distinguishable from a row that was never swept. Otherwise the operator cannot tell what
  happened, and a half-finished payout looks identical to a finished one.
- **Numbers** — right-align, tabular figures (`font-variant-numeric: tabular-nums`), fixed decimal
  places so values do not jitter on each 5s tick.
