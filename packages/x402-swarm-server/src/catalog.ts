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

// Subset of item.jsonld fields the server reads. The full JSON-LD doc carries more.
interface ItemJsonLd {
  id?: string;
  description?: string;
  lifecycle?: string;
  payment?: PaymentRequirements[];
}

// Catalog lookup prerequisite (CLAUDE.md §"Catalog lookup"): runs on every request before
// the X-Payment branch. Any miss returns early with the appropriate ApiError code.
export async function lookupItem(
  bee: Bee,
  catalogFeedOwner: string,
  itemId: string,
): Promise<CatalogLookup> {
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

  // 6. Read the per-item state feed (verification + actHistoryRef for the grant).
  let state: CatalogItemState;
  try {
    state = await readItemState(bee, catalogFeedOwner, itemId);
  } catch (err) {
    if (err instanceof NoStateFeedError) {
      throw new PurchaseError(
        'item_not_purchasable',
        `Item ${itemId} has no initialised state feed (§12.5)`,
      );
    }
    throw err;
  }

  return {
    itemId,
    description: doc.description ?? '',
    payments: doc.payment,
    state,
  };
}
