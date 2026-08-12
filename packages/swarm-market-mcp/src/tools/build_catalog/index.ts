/**
 * MCP Tool: build_catalog
 *
 * Thin orchestration layer over SwarmCatalogBuilder from @solarpunk/swarm-catalog.
 * Stages one or more CatalogItems and publishes them as a Swarm catalog: uploads
 * samples + item.jsonld + catalog.jsonld, builds/updates the catalog Mantaray
 * (copy-on-write), pushes the catalog feed, and initializes each per-item state feed.
 *
 * ACT wrapping is NOT done here. The caller uploads + ACT-wraps content first (e.g.
 * via swarm-mcp's upload_data with act: true, optionally combined with create_grantees
 * / patch_grantees) and passes the captured { actHistoryRef, granteeRef } in each
 * item's actSeed.
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
import { resolvePayTo } from '../../splitter';
import { BuildCatalogArgs } from './models';

export async function buildCatalog(args: BuildCatalogArgs, bee: Bee): Promise<ToolResponse> {
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

  if (!args.items || args.items.length === 0) {
    return getToolErrorResponse('Missing required parameter: items.');
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

  // Stage each item. stageItem/seedActState throw on invalid input — surface as readable errors.
  try {
    for (const entry of args.items) {
      // Resolve payTo to the seller's split contract before staging, so every published listing
      // settles through the taxed path. Throws if a caller-supplied payTo points elsewhere.
      const payment = await resolvePayTo(entry.item.payment, entry.item.id);
      builder.stageItem({ ...entry.item, payment });
      builder.seedActState(entry.item.id, entry.actSeed);
      if (entry.sampleData != null) {
        const sampleBytes =
          entry.sampleEncoding === 'base64'
            ? new Uint8Array(Buffer.from(entry.sampleData, 'base64'))
            : entry.sampleData;
        builder.stageSampleData(entry.item.id, sampleBytes);
      }
    }
    if (args.catalogMeta) {
      builder.setCatalogMeta(args.catalogMeta);
    }
  } catch (err) {
    return getToolErrorResponse(`Catalog staging failed: ${getErrorMessage(err)}`);
  }

  try {
    const result = await builder.publish();
    return getResponseWithStructuredContent({
      ...result,
      message: `Published catalog with ${args.items.length} item(s).`,
    });
  } catch (err) {
    return getToolErrorResponse(`Catalog publish failed: ${getErrorMessage(err)}`);
  }
}
