/**
 * MCP Tool: delete_catalog_item
 *
 * Removes one or more items from a Swarm catalog. Thin orchestration layer over
 * SwarmCatalogBuilder: stages a removal per itemId, then publish() copy-on-writes a
 * new catalog Mantaray with those /items/{itemId}/ forks dropped and pushes the
 * catalog feed update.
 *
 * Swarm chunks are immutable — this does not erase uploaded content; it makes the
 * catalog feed resolve to a Mantaray that no longer references the removed items.
 * The orphaned content expires when its postage stamp lapses.
 */
import { Bee } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder } from '@solarpunk/swarm-catalog';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
} from '../../utils';
import { DeleteCatalogItemArgs } from './models';

export async function deleteCatalogItem(
  args: DeleteCatalogItemArgs,
  bee: Bee,
): Promise<ToolResponse> {
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

  if (!args.itemIds || args.itemIds.length === 0) {
    return getToolErrorResponse('Missing required parameter: itemIds.');
  }

  // The builder validates the cold/hot key split at construction (throws if they match).
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

  for (const itemId of args.itemIds) {
    builder.stageRemove(itemId);
  }

  try {
    const result = await builder.publish();
    return getResponseWithStructuredContent({
      ...result,
      message: `Removed ${args.itemIds.length} item(s) from the catalog.`,
    });
  } catch (err) {
    return getToolErrorResponse(`Catalog item removal failed: ${getErrorMessage(err)}`);
  }
}
