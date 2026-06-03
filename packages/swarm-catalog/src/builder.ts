import { Bee, MantarayNode, PrivateKey } from '@ethersphere/bee-js';
import { CATALOG_FEED_TOPIC, readCatalogFeedRoot } from './feeds.js';
import { itemManifestPath, itemSamplePath, CATALOG_MANIFEST_PATH } from './paths.js';
import { serializeItem, serializeCatalog } from './jsonld.js';
import { writeItemState } from './state.js';
import { LIFECYCLE_VALUES } from './types.js';
import type {
  CatalogItem,
  CatalogItemState,
  ContentSpec,
  Lifecycle,
  PaymentRequirements,
} from './types.js';

type FeedSigner = PrivateKey | Uint8Array | string;

interface BuilderOpts {
  bee: Bee;
  catalogFeedSigner: FeedSigner;
  itemStateFeedSigner: FeedSigner;
  postageBatchId: string;
}

interface PublishResult {
  catalogRoot: string;
  feedUpdateTxId: string;
  stateFeeds: Array<{ itemId: string; reference: string }>;
}

interface ActSeed {
  actHistoryRef: string;
  granteeRef: string;
}

export class SwarmCatalogBuilder {
  private readonly bee: Bee;
  private readonly catalogFeedSigner: FeedSigner;
  private readonly itemStateFeedSigner: FeedSigner;
  private readonly postageBatchId: string;
  // Derived from catalogFeedSigner — used as the catalog feed owner address for state feed topics.
  private readonly catalogFeedOwner: string;

  private staged = new Map<string, CatalogItem>();
  private removals = new Set<string>();
  private lifecycleChanges = new Map<string, Lifecycle>();
  // Prototype extension: ACT history and grantee refs from caller's ACT wrapping step.
  private actSeeds = new Map<string, ActSeed>();
  // Prototype extension: sample bytes to upload during publish().
  private sampleData = new Map<string, Uint8Array | string>();

  constructor(opts: BuilderOpts) {
    this.bee = opts.bee;
    this.catalogFeedSigner = opts.catalogFeedSigner;
    this.itemStateFeedSigner = opts.itemStateFeedSigner;
    this.postageBatchId = opts.postageBatchId;
    // Derive the catalog feed owner EOA address from the signer key.
    const pk =
      opts.catalogFeedSigner instanceof PrivateKey
        ? opts.catalogFeedSigner
        : new PrivateKey(opts.catalogFeedSigner);
    this.catalogFeedOwner = '0x' + pk.publicKey().address().toHex();
  }

  // Queue an item for the next publish. Validates immediately; throws on invalid input.
  stageItem(input: CatalogItem): void {
    validateItem(input);
    warnItem(input);
    this.staged.set(input.id, input);
  }

  // Queue removal of an item from the catalog Mantaray.
  stageRemove(itemId: string): void {
    this.removals.add(itemId);
  }

  // Queue a lifecycle change for an item already in the catalog.
  // If the item is also staged, the staged item's lifecycle takes precedence.
  stageLifecycle(itemId: string, lifecycle: Lifecycle): void {
    this.lifecycleChanges.set(itemId, lifecycle);
  }

  // Prototype extension: provide the initial ACT history and grantee refs for a staged item.
  // Must be called before publish() for every priced item (payment array non-empty).
  // In a full spec implementation the builder would handle ACT wrapping itself.
  seedActState(itemId: string, state: ActSeed): void {
    this.actSeeds.set(itemId, state);
  }

  // Prototype extension: provide raw sample bytes to upload during publish().
  // The bytes are uploaded and linked into the Mantaray at /items/{itemId}/{sample.path}.
  stageSampleData(itemId: string, data: Uint8Array | string): void {
    this.sampleData.set(itemId, data);
  }

  // Compute the new Mantaray structure locally without uploading (§12.4 dry-run mode).
  // Returns an empty root string because no Swarm uploads are performed.
  // The manifest can be inspected to verify paths and structure.
  async dryRun(): Promise<{ root: string; manifest: MantarayNode }> {
    const node = new MantarayNode();
    for (const [itemId] of this.staged) {
      node.addFork(itemManifestPath(itemId), new Uint8Array(32), null);
    }
    return { root: '', manifest: node };
  }

  // Publish all staged changes to Swarm and push the catalog feed update.
  // Maps to spec §12.2 steps 3–8 (steps 1–2 are delegated to the caller).
  async publish(): Promise<PublishResult> {
    // Apply pending lifecycle changes to staged items before validation.
    for (const [itemId, lifecycle] of this.lifecycleChanges) {
      const staged = this.staged.get(itemId);
      if (staged) {
        this.staged.set(itemId, { ...staged, lifecycle });
      }
    }

    // All priced staged items must have an ACT seed before we can write state feeds.
    for (const [itemId, item] of this.staged) {
      if (item.payment.length > 0 && !this.actSeeds.has(itemId)) {
        throw new Error(
          `Missing ACT seed for priced item "${itemId}". Call seedActState() before publish().`,
        );
      }
    }

    // Step 5 (§12.2): Load previous catalog Mantaray (copy-on-write) or start fresh.
    let manifest: MantarayNode;
    try {
      const prevRoot = await readCatalogFeedRoot(this.bee, this.catalogFeedOwner);
      manifest = await MantarayNode.unmarshal(this.bee, prevRoot);
      await manifest.loadRecursively(this.bee);
    } catch {
      manifest = new MantarayNode();
    }

    const now = new Date().toISOString();

    // Steps 3–4 (§12.2): Upload samples + item.jsonld for each staged item.
    for (const [itemId, item] of this.staged) {
      // Step 3: Upload sample data if provided via stageSampleData().
      const sampleBytes = this.sampleData.get(itemId);
      if (item.sample && sampleBytes != null) {
        const sampleResult = await this.bee.uploadData(this.postageBatchId, sampleBytes);
        const sampleManifestPath = itemSamplePath(itemId, item.sample.path);
        manifest.addFork(sampleManifestPath, sampleResult.reference.toString(), null);
      }

      // Step 4: Serialize and upload item.jsonld. Inline fork metadata (§5.5) is empty for prototype.
      const itemJsonLd = serializeItem(item);
      const itemJsonLdBytes = JSON.stringify(itemJsonLd, null, 2);
      const itemResult = await this.bee.uploadData(this.postageBatchId, itemJsonLdBytes);
      manifest.addFork(itemManifestPath(itemId), itemResult.reference.toString(), null);
    }

    // Process removals: remove item.jsonld fork from Mantaray.
    for (const itemId of this.removals) {
      manifest.removeFork(itemManifestPath(itemId));
    }

    // Process lifecycle changes for items NOT in the staged set.
    // Prototype limitation: in-place Mantaray update requires downloading and re-uploading item.jsonld.
    for (const [itemId, lifecycle] of this.lifecycleChanges) {
      if (this.staged.has(itemId)) continue; // already handled above
      const node = manifest.find(itemManifestPath(itemId));
      if (!node || !node.targetAddress || node.targetAddress.every((b) => b === 0)) {
        console.warn(`[swarm-catalog] Lifecycle change for unknown item ${itemId}, skipping`);
        continue;
      }
      try {
        const existing = await this.bee.downloadData(node.targetAddress);
        const parsed = JSON.parse(existing.toUtf8()) as Record<string, unknown>;
        parsed['lifecycle'] = lifecycle;
        const updated = JSON.stringify(parsed, null, 2);
        const updatedResult = await this.bee.uploadData(this.postageBatchId, updated);
        manifest.addFork(itemManifestPath(itemId), updatedResult.reference.toString(), null);
      } catch (err) {
        console.warn(`[swarm-catalog] Failed to update lifecycle for ${itemId}, skipping:`, err);
      }
    }

    // Upload catalog.jsonld (collection-level metadata).
    const catalogJsonLd = serializeCatalog(Array.from(this.staged.values()));
    const catalogJsonLdBytes = JSON.stringify(catalogJsonLd, null, 2);
    const catalogDataResult = await this.bee.uploadData(this.postageBatchId, catalogJsonLdBytes);
    manifest.addFork(CATALOG_MANIFEST_PATH, catalogDataResult.reference.toString(), null);

    // Step 6 (§12.2): Upload new Mantaray and capture root reference.
    const saveResult = await manifest.saveRecursively(this.bee, this.postageBatchId);
    const catalogRoot = saveResult.reference.toString();

    // Step 7 (§12.2): Push catalog feed update — bare 64-char hex payload, no envelope.
    const catalogFeedWriter = this.bee.makeFeedWriter(CATALOG_FEED_TOPIC, this.catalogFeedSigner);
    const feedResult = await catalogFeedWriter.uploadPayload(this.postageBatchId, catalogRoot);
    const feedUpdateTxId = feedResult.reference.toString();

    // Step 8 (§12.2): Initialize per-item state feeds for staged items.
    const stateFeedResults: Array<{ itemId: string; reference: string }> = [];
    for (const [itemId, item] of this.staged) {
      const actSeed = this.actSeeds.get(itemId);
      if (!actSeed) continue; // free items have no state feed
      const state: CatalogItemState = {
        itemId,
        actHistoryRef: actSeed.actHistoryRef,
        granteeRef: actSeed.granteeRef,
        lifecycle: item.lifecycle,
        version: item.version,
        catalogRootAtUpdate: catalogRoot,
        dateModified: now,
      };
      const stateRef = await writeItemState(
        this.bee,
        this.itemStateFeedSigner,
        this.catalogFeedOwner,
        state,
        this.postageBatchId,
      );
      stateFeedResults.push({ itemId, reference: stateRef });
    }

    return { catalogRoot, feedUpdateTxId, stateFeeds: stateFeedResults };
  }
}

// --- Validation (§12.3) ---
function validateItem(input: CatalogItem): void {
  if (input.id !== input.storage.reference) {
    throw new Error(
      `CatalogItem validation: id must equal storage.reference ` +
        `(id: ${input.id}, storage.reference: ${input.storage.reference})`,
    );
  }
  if (!input.payment || input.payment.length === 0) {
    throw new Error(`CatalogItem validation: payment array must not be empty (id: ${input.id})`);
  }
  if (!LIFECYCLE_VALUES.includes(input.lifecycle)) {
    throw new Error(
      `CatalogItem validation: invalid lifecycle "${input.lifecycle}" (id: ${input.id})`,
    );
  }

  const c = input.content;
  // Use a plain record for runtime presence checks — TypeScript's required fields
  // would otherwise narrow the conditions to never.
  const cr = c as ContentSpec & Record<string, unknown>;
  if (!cr.encodingFormat) {
    throw new Error(`CatalogItem validation: content.encodingFormat is required (id: ${input.id})`);
  }
  if ((c.type === 'image' || c.type === 'video') && (cr.width == null || cr.height == null)) {
    throw new Error(
      `CatalogItem validation: width and height are required for ${c.type} content (id: ${input.id})`,
    );
  }
  if ((c.type === 'video' || c.type === 'audio') && cr.duration == null) {
    throw new Error(
      `CatalogItem validation: duration is required for ${c.type} content (id: ${input.id})`,
    );
  }
  if (input.license && isUrlShaped(input.license) && !isValidIri(input.license)) {
    throw new Error(
      `CatalogItem validation: license is not a valid IRI "${input.license}" (id: ${input.id})`,
    );
  }
  for (const p of input.payment as PaymentRequirements[]) {
    if (p.facilitator && !isValidIri(p.facilitator)) {
      throw new Error(
        `CatalogItem validation: payment.facilitator is not a valid IRI "${p.facilitator}" (id: ${input.id})`,
      );
    }
  }
}

function warnItem(input: CatalogItem): void {
  if (!input.license) {
    console.warn(`[swarm-catalog] Warning: license missing for item ${input.id}`);
  }
  if (input.tags && input.tags.length > 20) {
    console.warn(
      `[swarm-catalog] Warning: tags exceed soft cap of 20 for item ${input.id} (${input.tags.length} tags)`,
    );
  }
  if (!input.sample && input.payment.length > 0) {
    const maxAmount = Math.max(...input.payment.map((p) => parseInt(p.amount, 10) || 0));
    if (maxAmount >= 1_000_000) {
      console.warn(
        `[swarm-catalog] Warning: no sample for item ${input.id} with price ${maxAmount} (≥ 1 USDC equivalent)`,
      );
    }
  }
}

function isUrlShaped(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('ftp://');
}

function isValidIri(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
