# marketplace-ui

Marketplace operator dashboard: a read-mostly view of the `SplitterFactory` registry showing the
treasury, every seller, every seller's `RevenueSplitter` clone, their balances, and a
**Distribute** action that sweeps a clone's accrued revenue to seller + treasury.

This is an **operator/demo surface**, not a consumer surface. It answers "who is selling, what has
accrued, and has it been paid out" — it does not browse catalogs, purchase, or touch Swarm. There
is no Bee dependency in this package.

Two views, behind a top nav: **Dashboard** (the above, and the home route) and **Map of Agents**, a
force-directed view of the same purchases and payouts as a network — agents are nodes, the payments
between them are edges. The map adds no fetching; it is a second reading of what the Dashboard
already loads.

Behind `VITE_SHOW_DEMO_FLOW` there are two more pages, demo scaffolding rather than product
surface: **Devcon** (`#/devcon`), a QR code that hands the audience off from the projected
dashboard to their own phone, and **Claim wallet** (`#/claim-wallet`), the page that code points
at — where a buyer agent will be created to purchase a funded wallet from a seller agent. With the
flag off the nav item disappears and both hashes resolve to the Dashboard, because a scanned QR
code outlives the build that printed it. Only `#/devcon` is in the nav: you reach `#/claim-wallet`
by scanning, so nothing should highlight while you are on it.

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

Mirrors `erc8004-dashboard` — Vite + React 18 + TypeScript, plain CSS, no UI framework — with two
deliberate divergences:

| Concern   | Choice                               | Why                                                                                               |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Bundler   | Vite 5                               | same as `erc8004-dashboard`                                                                       |
| UI        | React 18 + TypeScript 5.7            | same as `erc8004-dashboard`                                                                       |
| Chain lib | **viem** (not ethers v6)             | `@solarpunk/contracts` is viem-only; duplicating its ABIs in ethers is worse than diverging       |
| Styling   | CSS Modules over a shared token file | `erc8004-dashboard` uses inline styles with hardcoded hex; that does not scale to this many rows  |
| Wallet    | raw EIP-1193 (`window.ethereum`)     | two write paths, no session state; wagmi/RainbowKit is not worth the dependency weight            |
| Graph     | **`react-force-graph-2d`**           | the Map of Agents needs a force layout; hand-rolling one is worse than taking the canvas renderer |

`react-force-graph-2d` is the single largest stack decision in this package's life: it takes it
from 4 runtime dependencies to roughly 40 installed packages (~200 kB minified), and it is a
rendering library, which the rule below otherwise forbids. It was chosen over `d3-force` alone and
over a hand-written simulation because drag, zoom, hit-testing and collision are the parts that
actually cost time, and they are the parts it gives you. It renders to **canvas**, which is why
`AgentGraph.tsx` reads `theme.ts` directly (see Theme). Nothing else may follow it in: the
exception is for the graph, not a general relaxation.

One narrower exception has since been taken: **`qrcode-generator`**, for the Devcon page's QR code.
It is a single package with zero transitive dependencies (21 kB minified, 8 kB gzipped), and the
alternative was owning ~280 lines of Reed-Solomon error correction, version selection and mask
scoring — specified, fiddly, and with no interesting failure modes to test against. It is used for
the **matrix only**: `QrCode.tsx` reads `getModuleCount()` / `isDark()` and emits its own SVG,
because `createSvgTag()` / `createImgTag()` return HTML strings (which would need
`dangerouslySetInnerHTML`) with their colours baked in. Treat this the way you treat the graph —
a named exception, not a precedent.

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
subtitle changed to describe the current view (e.g. "Marketplace treasury and seller revenue" on
the Dashboard, "Agents and the payments between them" on the map). The wordmark never changes; the
nav below it says which view you are on.

A 2D canvas context cannot read `var(--mp-*)`, so `AgentGraph.tsx` imports `theme` from
`theme.ts` and uses the values directly. That is the sanctioned form of "never inline a hex", not
an exception to it — a colour still has exactly one definition. `linkPurchase` and `linkPayout`
were added there for the edges.

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

Map of Agents (`#/map`):

```
[ 24h ][ 7d ][ 30d ][ All ]        (period filter — local state, never the URL)

  force-graph canvas: agents as nodes, payments as edges
  legend: seller / buyer / both / treasury

  selected-node detail: received · sent · purchases · counterparties
                        distributed to seller · tax to treasury

AGENT TABLE (sortable)
  agent (+ role)   in   out   txs   peers   pending
```

## Map of Agents

`lib/graph.ts` derives the whole thing from the registry, agent links and history the context
already holds. It fetches nothing — the single-fetch-owner rule is not relaxed for this view.

**One address, one node.** A splitter clone is plumbing, not an actor: an agent's clone, seller
EOA, registered agent wallet and NFT owner all collapse onto one node keyed by the clone. Without
that collapse an agent that both sells and buys renders as two disconnected dots, which is exactly
the relationship the map exists to show. Node ids are bare lowercased addresses — never
role-prefixed, since prefixing recreates the duplicate it looks like it prevents.

**Lowercase every key.** `bySplitter` is keyed lowercase, a purchase's `splitter` is a decoded log
arg and therefore checksummed, and a payout's is `log.address` and therefore not. Mixing them
joins one kind of row and silently drops the other.

**Only the treasury half of a payout is an edge.** `Distributed` carries both halves, but the
seller's share moves from its clone to its EOA — the same participant here, so drawing it would be
a self-loop. Both figures are on the node so the treasury edge is never read as the whole
distribution.

**An untimed entry is inside every period.** `loadHistory` returns rows with no timestamp and
`attachTimestamps` fills them in a second pass, so a filter that excluded them would empty itself
on every sweep, not just the first. `applyCachedTimestamps` closes most of that window at the
source; including unknowns closes the rest. Never filter the map by block number instead — that
introduces a second, fuzzier truth about "when" alongside the exact one already there.

**The 200-event cap is stated, not hidden.** `HISTORY_LIMIT` applies after sorting newest-first,
across both kinds and the whole window, so a longer period can never widen past it. `Truncation`
answers this exactly rather than by guess: the view is provably complete when the oldest retained
event predates the period cutoff, and the banner appears only when it does not. Do not raise
`HISTORY_LIMIT` to "fix" this — the first `attachTimestamps` is one batched request of N
`eth_getBlock` calls, and `blockTimes` has no eviction.

**Identity preservation is what keeps the layout still.** force-graph stamps `x/y/vx/vy/index/
__indexColor` onto node objects in place and treats an array of all-new objects as a new graph:
colour tracker reset, d3 re-seeded, layout thrown across the canvas. `reconcile` reuses the object
for an id already on screen, and `graphSignature` gates the derivation so a tick that changed
nothing does not re-derive at all. Both are load-bearing — the context hands out a new value every
5s whether or not anything changed.

**Every canvas accessor must be stable.** `react-force-graph-2d` diffs props by reference, so an
inline lambda is re-applied on every render. Module-level constants or `useCallback`, and
`AgentGraph` is memoised so the balance tick stops at its boundary.

**Keeping nodes apart is ours, not force-graph's.** Charge cannot separate buyers: each pays
several sellers, so they share a barycentre and pile up there however hard the sellers are pushed
out. `separateOverlaps` resolves overlaps directly, on an animation frame `AgentGraph` owns. Two
force-graph extension points were tried first and **both fail silently** — a force installed with
`d3Force('collide', …)` registers and initialises with the right nodes but is never invoked, and
`onEngineTick` is applied once and never replaced, so under StrictMode's double mount the
surviving callback is the discarded first instance's, frozen on the node array from before any
buyer existed. Charge and link distance still go through `d3Force`, which does work for those.

**Escape anything from an Agent Card.** Node tooltips are injected as HTML and card names are
third-party strings — anyone can register an agent called anything.

**Avatars never touch the pointer-area canvas.** A `verified` agent's node is painted with its card
`image` instead of a flat dot. force-graph hit-tests by painting each node in a unique colour to a
second, shadow canvas and reading the pixel under the cursor back with `getImageData`; a
cross-origin image taints whatever canvas it reaches, and `getImageData` on a tainted canvas throws
`SecurityError`, killing every click and hover at once. Card images come from a Swarm gateway that
is not ours, so that is the ordinary case. `nodePointerAreaPaint` therefore paints plain circles
and the taint stays on the visible canvas, which nothing reads back. For the same reason
`crossOrigin` is left unset on the loader — requesting CORS from a gateway that sends no header
fails the load outright.

Three more consequences of putting a face on a node, all deliberate:

- **Verified only.** An image reads as identity far more strongly than a name does, so
  `unverified` / `disputed` links stay as dots rather than borrowing the map's authority for a
  claim `AgentBadge` explicitly hedges. It is also unsanitisable in a way a name is not: `image` is
  an arbitrary picture from a URL its own subject controls.
- **Role moves to the ring.** The avatar takes the fill that used to carry seller / buyer / both,
  and that encoding is what the legend promises — an agent's picture says nothing about which side
  it trades on. Selection and the treasury ring move outboard so two rings never overlap.
- **`AVATAR_MIN_RADIUS` breaks size ∝ activity below ~5 purchases**, and is keyed on `avatarUrl`
  rather than the decoded sprite so the layout does not shift when an image lands. Both are worth
  it; neither is free. A late sprite still needs a repaint nudge, because `autoPauseRedraw` is on
  by default and a settled canvas has stopped painting — re-identifying `nodeCanvasObject` is that
  nudge, and unlike re-applying `graphData` it does not restart the layout.

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

| Variable                            | Required | Default                    | Purpose                                                          |
| ----------------------------------- | -------- | -------------------------- | ---------------------------------------------------------------- |
| `VITE_TREASURY_ADDRESS`             | yes      | —                          | Marketplace treasury shown in the Treasury section               |
| `VITE_SPLITTER_FACTORY_ADDRESS`     | yes      | —                          | `SplitterFactory` to enumerate                                   |
| `VITE_CHAIN_ID`                     | no       | `84532`                    | Base Sepolia. Selects the viem chain and the currency config     |
| `VITE_RPC_URL`                      | no       | `https://sepolia.base.org` | **Required in practice** — the public node rate-limits           |
| `VITE_REFRESH_INTERVAL_MS`          | no       | `5000`                     | Balance poll interval                                            |
| `VITE_IDENTITY_REGISTRY_ADDRESS`    | no       | known per chain            | ERC-8004 registry, for labelling rows with their agent           |
| `VITE_IDENTITY_REGISTRY_FROM_BLOCK` | no       | registry deploy block      | Start of the `agent_splitter` log sweep                          |
| `VITE_LOG_CHUNK_BLOCKS`             | no       | `500000`                   | Blocks per `eth_getLogs` call; lower it if the index is partial  |
| `VITE_SHOW_DEMO_FLOW`               | no       | `false`                    | Enables `#/devcon` and `#/claim-wallet`. `"true"`/`"false"` only |
| `VITE_DEMO_FLOW_BASE_URL`           | no       | `window.location.origin`   | Base URL the demo QR encodes; only read when the flag is on      |

`VITE_RPC_URL` is not in the original spec for this dashboard but is not optional in reality:
`VITE_CHAIN_ID` selects a chain, it does not provide a transport. Mirror the wording of
`erc8004-dashboard/.env.example`, which already documents the rate-limit failure mode.

Validate all of it once at startup in `src/config/env.ts` and fail loudly with a readable message.
A dashboard that renders empty because `VITE_TREASURY_ADDRESS` was unset is worse than one that
refuses to boot.

## Agent identity

Seller rows are labelled with the ERC-8004 agent that owns the clone. The binding is **Identity
Registry metadata** under the `agent_splitter` key (`AGENT_SPLITTER` in
`erc8004-adapter/src/constants.ts`), written by the `link_split_contract` MCP tool.

It is deliberately **not** stored in the clone. `createSplitter` is permissionless, so an agentId
held by the factory would be a claim anyone could make about anyone; the registry already gates
`setMetadata` on NFT ownership. And clone terms are frozen at `initialize` while agent NFT
ownership can transfer, so a binding baked into the clone would decay into a lie with no way to
correct it. Do not add `agentId` to `RevenueSplitter` or `SplitterFactory`.

Because `MetadataSet` indexes the metadata key, the whole splitter → agent reverse index is one
`eth_getLogs` call rather than a crawl over every Agent Card.

**A claim is not proof.** Any agent owner can name any address, so `lib/agents.ts` verifies before
the badge says "verified":

1. the claimed splitter is in the factory registry (claims on unknown addresses are discarded), and
2. the clone's frozen `seller` is the agent's registered wallet (`getAgentWallet`) or its NFT owner
   (`ownerOf`).

Anything else renders as `unverified`, and two agents claiming one clone renders as `disputed` —
never silently resolved in favour of whichever log came last.

Three constraints on this feature, all load-bearing:

- **It is optional.** No registry for the chain, an unreachable node, or a failed sweep must leave
  balances rendering normally. It is labelling, not data.
- **A partial sweep proves nothing.** The log scan is chunked and gives up rather than throwing; when
  it is cut short, rows show no "No agent linked" text, because absence is no longer evidence.
- **This package stays viem-only.** It does not import `@solarpunk/erc8004-adapter` (ethers, plus
  bee-js). `lib/agents.ts` declares a five-entry viem ABI subset of the registry instead — the
  "no ABIs here" rule is about the splitter contracts, which still go through the SDK.

### Agent names

The badge shows the agent's name from its Agent Card: `tokenURI(agentId)` gives the card's
location, which `enrichWithCards` fetches with a plain `fetch` (an https feed URL is used as-is;
`bzz://` is resolved through `VITE_SWARM_GATEWAY_URL`).

This is the one place the package reaches outside the chain — there is still **no Bee dependency**,
just an HTTP GET. Treat it as unreliable by construction: the gateway is not ours, CORS may reject
the request, a cold feed may not resolve, and it may simply be slow. So:

- The card pass runs **after** the on-chain index has already been rendered, never before. The
  badge must never wait on a gateway.
- Every failure path returns undefined and the badge falls back to the bare agent id. A missing
  name is a degraded label, never a missing agent.
- One fetch per distinct agent, not per row, with an 8s abort — the same agent can hold several
  clones.

The same fetch also yields the card's `image`, which the Map of Agents paints as the node. It is
resolved through `resolveCardUrl` like the card's own location, so it follows http(s) and `bzz://`
and nothing else — a `data:` or `javascript:` URL out of a third-party card is dropped rather than
handed to a renderer.

### Catalog link

The same card fetch yields the catalog link. The feed owner is the `endpoint` of the card's
`swarm-ai-catalog` service entry — a bare EOA, deliberately a different key from the card's own
feed signer, so it cannot be derived from the card's location.

`catalogUrl()` points at `VITE_CATALOGUE_FEED_BROWSER_URL` (default `http://localhost:3001`,
matching `erc8004-dashboard/src/constants.ts`) and falls back to the raw Swarm feed
`<gateway>/feeds/<owner>/<CATALOG_FEED_TOPIC>` when that is unset. `CATALOG_FEED_TOPIC` is the
fixed protocol constant `keccak256("swarm-ai-catalog.v1")`, mirroring
`swarm-catalog/src/feeds.ts` — do not derive it per chain or per agent.

`CatalogLink` renders **nothing** when no feed owner resolved, rather than a dead link. A seller
can legitimately hold a splitter and publish no catalog, and from here that is indistinguishable
from a card that failed to fetch.

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
  App.tsx                   — ConfigFailure, the providers, and the route switch
  theme.ts                  — colour tokens + applyTheme() (see Theme above)
  index.css                 — reset + body, matching erc8004-dashboard/src/index.css
  config/
    env.ts                  — parse + validate import.meta.env; exports `config` or `configError`
    currencies.ts           — CURRENCIES by chain id, plus the erc20Currencies() filter
    registry.ts             — ERC-8004 Identity Registry address + deploy block per chain
    chain.ts                — viem chain object + explorer address/tx URL builders
  context/
    MarketplaceContext.tsx  — registry + balances + polling; the single fetch owner
    WalletContext.tsx       — EIP-1193 connect / account / chain id / switch chain
  lib/
    reads.ts                — every on-chain read: loadRegistry, readBalances, isFunded
    agents.ts               — splitter -> ERC-8004 agent index, with verification
    history.ts              — purchases + payouts from chain logs; the map's edge set
    graph.ts                — the network derivation: deriveGraph, graphSignature, reconcile
    format.ts               — formatTaxBps (via the SDK BPS_DENOMINATOR), formatAge
    rpcError.ts             — wallet/RPC errors to one readable line; user-rejection detection
  hooks/
    useHashRoute.ts         — the two-page hash router; nothing else lives in the URL
    usePolling.ts           — interval + document.hidden pause
    useTxLifecycle.ts       — shared idle/signing/pending/confirmed state machine
    useDistribute.ts        — one clone; wraps useTxLifecycle
    useDistributeAll.ts     — batch sweep; wraps the same useTxLifecycle
  components/
    styles.module.css       — shared CSS module for every component
    AppShell.tsx            — header, nav and page container; wraps both views
    StatusPills.tsx         — live/stale/loading pill in the header
    StaleBanner.tsx         — last-tick-failed notice; used by both views
    MapPage.tsx             — Map of Agents: period filter, memo gate, live node objects
    DevconPage.tsx          — demo hand-off: the QR code and its resolved URL
    ClaimWalletPage.tsx     — the QR code's target; empty until the buyer flow lands
    QrCode.tsx              — QR matrix as inline SVG; dark-on-light, 4-module quiet zone
    AgentGraph.tsx          — the force-graph canvas; memoised, explicitly sized
    AgentTable.tsx          — sortable per-agent numbers under the map
    TreasurySection.tsx
    SellerSection.tsx
    SellerRow.tsx
    HistorySection.tsx      — Activity: filters, partial-sweep banner
    HistoryTable.tsx        — purchase/payout rows
    AddressLink.tsx         — address + copy + explorer icon; used by every section
    AgentBadge.tsx          — the seller's ERC-8004 agent, with its verification status
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
    "react-force-graph-2d": "^1.29.1",
    "viem": "^2.21.0"
  }
}
```

`react-force-graph-2d` pulls `force-graph` and `react-kapsule`. Keep `react-kapsule` at **2.6.0 or
later**: that is the release with the React 18 StrictMode double-mount fix, and below it the canvas
fails to re-initialise on a remount.

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
