import { Bee, MantarayNode } from '@ethersphere/bee-js';
import {
  readCatalogFeedRoot,
  readItemState,
  itemManifestPath,
  NoStateFeedError,
  type CatalogItemState,
  type PaymentRequirements,
} from '@solarpunk/swarm-catalog';
import { PurchaseError } from './errors.js';

// What the purchase handler needs from the catalog: the item's price terms, lifecycle,
// and its current ACT state (actHistoryRef is required for the grant at step 10).
export interface CatalogLookup {
  itemId: string;
  description: string;
  payments: PaymentRequirements[];
  state: CatalogItemState;
}

// The half of a lookup that cannot change for a given itemId — see CatalogCache.
type CatalogEntry = Omit<CatalogLookup, 'state'>;

// Subset of item.jsonld fields the server reads. The full JSON-LD doc carries more.
interface ItemJsonLd {
  id?: string;
  description?: string;
  lifecycle?: string;
  payment?: PaymentRequirements[];
}

// Resolve the catalog feed and walk the Mantaray to one item's JSON-LD leaf. Steps 1-5 of the
// catalog lookup prerequisite (CLAUDE.md §"Catalog lookup").
//
// Measured against the shared publisher Bee node: ~3s, essentially all of it the feed
// resolution. The Mantaray walk itself is free once the root is known (the chunks are in the
// local store — ~3ms), so there is nothing to win by caching below this level.
async function readCatalogEntry(
  bee: Bee,
  catalogFeedOwner: string,
  itemId: string,
): Promise<CatalogEntry> {
  // 1. Resolve the catalog feed → Mantaray root. A missing feed means an empty catalog.
  let root: string;
  try {
    root = await readCatalogFeedRoot(bee, catalogFeedOwner);
  } catch {
    throw new PurchaseError('item_not_found', `No catalog published for owner ${catalogFeedOwner}`);
  }

  // 2. Walk the Mantaray to the item's manifest.
  const manifest = await MantarayNode.unmarshal(bee, root);
  await manifest.loadRecursively(bee);

  // 3. Locate /items/{itemId}/item.jsonld.
  const node = manifest.find(itemManifestPath(itemId));
  if (!node || !node.targetAddress || node.targetAddress.every((b) => b === 0)) {
    throw new PurchaseError('item_not_found', `Item ${itemId} is not in the catalog`);
  }

  // 4. Fetch + parse the JSON-LD leaf.
  const raw = await bee.downloadData(node.targetAddress);
  const doc = JSON.parse(raw.toUtf8()) as ItemJsonLd;

  // 5. retired is not purchasable; deprecated remains purchasable.
  if (doc.lifecycle === 'retired') {
    throw new PurchaseError('item_retired', `Item ${itemId} is retired`);
  }
  if (!doc.payment || doc.payment.length === 0) {
    throw new PurchaseError('item_not_purchasable', `Item ${itemId} carries no payment terms`);
  }

  return { itemId, description: doc.description ?? '', payments: doc.payment };
}

// Step 6: read the per-item state feed (verification + actHistoryRef for the grant).
// ~2.5s, again almost entirely feed resolution.
async function readState(
  bee: Bee,
  catalogFeedOwner: string,
  itemId: string,
  stateFeedOwner: string,
): Promise<CatalogItemState> {
  try {
    return await readItemState(bee, catalogFeedOwner, itemId, stateFeedOwner);
  } catch (err) {
    if (err instanceof NoStateFeedError) {
      throw new PurchaseError(
        'item_not_purchasable',
        `Item ${itemId} has no initialised state feed (§12.5)`,
      );
    }
    throw err;
  }
}

// Uncached lookup. Kept exported for one-off callers and tests; the purchase path goes through
// CatalogCache, because it pays this cost twice per sale.
export async function lookupItem(
  bee: Bee,
  catalogFeedOwner: string,
  itemId: string,
  stateFeedOwner: string,
): Promise<CatalogLookup> {
  const entry = await readCatalogEntry(bee, catalogFeedOwner, itemId);
  const state = await readState(bee, catalogFeedOwner, itemId, stateFeedOwner);
  return { ...entry, state };
}

/**
 * The catalog lookup, memoised.
 *
 * A purchase runs the lookup **twice**: once to build the 402 challenge (no X-Payment header)
 * and again on the paid request seconds later, because it is a prerequisite that runs before
 * the X-Payment branch. Uncached that is ~15s of the ~28s a devcon8 sale used to take, and all
 * of it is Swarm feed resolution — the index lookahead search, not chunk retrieval.
 *
 * The two halves are cached differently because they differ in kind:
 *
 * - **The catalog entry** (price terms, description, lifecycle) is immutable for a given
 *   itemId. Catalog entries are content-addressed, so republishing an item yields a *new*
 *   itemId and therefore a cache miss; nothing can change under a key. The TTL exists only so
 *   an item published after this server started becomes visible without a restart.
 *
 * - **The item state** carries `actHistoryRef`/`granteeRef`, which advance on every grant —
 *   and **this server is their sole writer**. So it is read once and then held in memory,
 *   advanced by `noteGrant` as each sale completes. Re-reading the feed would be slower *and*
 *   staler: the feed write happens after the response, so a concurrent purchase reading it
 *   gets pre-grant refs, whereas the in-memory cell is current the instant a grant returns.
 *
 * On the pre-existing grant race this neither fixes nor worsens: two purchases that settle
 * concurrently can still both patch from the same refs, dropping one grantee from the
 * canonical list. Each buyer downloads with the actHistoryRef handed back in its own response,
 * so neither loses access — only the published list is short an entry. Serialising the grant
 * would close it, at the cost of queueing every concurrent buyer behind a ~1.5s patchGrantees;
 * that trade is a deliberate no for a stand with ten phones on it.
 */
export class CatalogCache {
  // Promises, not values: on a cold cache ten phones scanning at once would otherwise each
  // start their own ~3s feed resolution. A rejected promise is evicted so the next request
  // retries rather than inheriting the failure.
  private readonly entries = new Map<string, { at: number; entry: Promise<CatalogEntry> }>();
  private readonly states = new Map<string, Promise<CatalogItemState>>();

  constructor(
    private readonly bee: Bee,
    private readonly catalogFeedOwner: string,
    private readonly stateFeedOwner: string,
    private readonly entryTtlMs: number,
  ) {}

  async lookup(itemId: string): Promise<CatalogLookup> {
    // Both halves start together — on a cold cache that halves the wait, since each is its own
    // feed resolution. But they must FAIL in the order the sequential version did: the catalog
    // entry decides item_not_found / item_retired, and only once the item is known to exist
    // does a missing state feed mean item_not_purchasable. With Promise.all the loser of a race
    // between two rejections sets the error code, so an unknown itemId reports whichever read
    // happened to fail first. allSettled + explicit precedence keeps the codes deterministic.
    const [entry, state] = await Promise.allSettled([this.entry(itemId), this.state(itemId)]);
    if (entry.status === 'rejected') throw entry.reason;
    if (state.status === 'rejected') throw state.reason;
    return { ...entry.value, state: state.value };
  }

  /**
   * Record the state this item reached after a grant, so the next purchase chains from it.
   *
   * Call this as soon as `patchGrantees` returns — not after the response. A devcon8 sale
   * spends ~9s funding the voucher wallet between those two points, and a purchase arriving
   * inside that window must not start from the refs this one already superseded.
   */
  noteGrant(itemId: string, state: CatalogItemState): void {
    this.states.set(itemId, Promise.resolve(state));
  }

  private entry(itemId: string): Promise<CatalogEntry> {
    const hit = this.entries.get(itemId);
    if (hit && Date.now() - hit.at < this.entryTtlMs) return hit.entry;

    const entry = readCatalogEntry(this.bee, this.catalogFeedOwner, itemId);
    this.entries.set(itemId, { at: Date.now(), entry });
    // Misses are never cached: a negative result would make a just-published item unbuyable
    // for a whole TTL, and an item_not_found costs a visitor the sale.
    entry.catch(() => this.entries.delete(itemId));
    return entry;
  }

  private state(itemId: string): Promise<CatalogItemState> {
    const hit = this.states.get(itemId);
    if (hit) return hit;

    // No TTL: after the first read this server owns the value outright, and nothing else
    // writes the feed. A restart re-reads it, which is the only time the feed is authoritative.
    const state = readState(this.bee, this.catalogFeedOwner, itemId, this.stateFeedOwner);
    this.states.set(itemId, state);
    state.catch(() => this.states.delete(itemId));
    return state;
  }
}
