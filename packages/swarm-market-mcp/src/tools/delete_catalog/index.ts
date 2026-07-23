/**
 * MCP Tool: delete_catalog
 *
 * Empties the entire catalog: derives the catalog feed owner from the catalog feed
 * signer (BEE_FEED_PK), reads the current Mantaray, enumerates every
 * /items/{itemId}/item.jsonld leaf, stages a removal for each, and publishes a
 * catalog Mantaray with all item forks dropped.
 *
 * Swarm chunks are immutable and feeds cannot be deleted — this pushes a new feed
 * update pointing at an emptied catalog. The owner key (BEE_FEED_PK) is the sole
 * authority that can do this; orphaned content expires when its postage stamp lapses.
 */
import { Bee, MantarayNode, PrivateKey } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder, readCatalogFeedRoot } from '@solarpunk/swarm-catalog';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
} from '../../utils';
import { DeleteCatalogArgs } from './models';

const ITEM_JSONLD_PATH_RE = /^\/?items\/([^/]+)\/item\.jsonld$/;

export async function deleteCatalog(args: DeleteCatalogArgs, bee: Bee): Promise<ToolResponse> {
  if (args.confirm !== true) {
    return getToolErrorResponse(
      'delete_catalog removes every item from the catalog. Pass confirm: true to proceed.',
    );
  }

  const catalogFeedSigner = config.bee.catalogFeedPrivateKey;
  if (!catalogFeedSigner) {
    return getToolErrorResponse('Missing catalog feed signer. Set BEE_FEED_PK (cold key).');
  }

  const itemStateFeedSigner = config.bee.itemStateFeedPrivateKey;
  if (!itemStateFeedSigner) {
    return getToolErrorResponse(
      'Missing per-item state feed signer. Set ITEM_STATE_FEED_PK (hot key).',
    );
  }

  const postageBatchId = args.postageBatchId ?? config.bee.postageBatchId;
  if (!postageBatchId) {
    return getToolErrorResponse(
      'Missing postage batch. Set POSTAGE_BATCH_ID or pass postageBatchId.',
    );
  }

  // The owner of the catalog feed is the EOA derived from the catalog feed signer.
  let owner: string;
  try {
    owner = '0x' + new PrivateKey(catalogFeedSigner).publicKey().address().toHex();
  } catch (err) {
    return getToolErrorResponse(
      `Invalid catalog feed signer (BEE_FEED_PK): ${getErrorMessage(err)}`,
    );
  }

  // Enumerate every current item by traversing the catalog Mantaray.
  let itemIds: string[];
  try {
    const root = await readCatalogFeedRoot(bee, owner);
    const manifest = await MantarayNode.unmarshal(bee, root);
    await manifest.loadRecursively(bee);
    itemIds = manifest
      .collect()
      .map((n) => ITEM_JSONLD_PATH_RE.exec(n.fullPathString)?.[1])
      .filter((id): id is string => id != null);
  } catch (err) {
    return getToolErrorResponse(
      `Could not read catalog for owner ${owner} (nothing to delete?): ${getErrorMessage(err)}`,
    );
  }

  if (itemIds.length === 0) {
    return getResponseWithStructuredContent({
      owner,
      removed: 0,
      message: 'Catalog is already empty.',
    });
  }

  let builder: SwarmCatalogBuilder;
  try {
    builder = new SwarmCatalogBuilder({
      bee,
      catalogFeedSigner,
      itemStateFeedSigner,
      postageBatchId,
    });
  } catch (err) {
    return getToolErrorResponse(`Failed to initialize catalog builder: ${getErrorMessage(err)}`);
  }

  for (const itemId of itemIds) {
    builder.stageRemove(itemId);
  }

  try {
    const result = await builder.publish();
    return getResponseWithStructuredContent({
      ...result,
      removed: itemIds.length,
      message: `Emptied catalog — removed ${itemIds.length} item(s).`,
    });
  } catch (err) {
    return getToolErrorResponse(`Catalog deletion failed: ${getErrorMessage(err)}`);
  }
}
