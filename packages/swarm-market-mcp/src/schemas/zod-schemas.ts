import { z } from 'zod';

// Deep field validation (id === storage.reference, required content fields, IRI checks)
// is performed by SwarmCatalogBuilder.stageItem. These schemas validate shape only.

const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  chainId: z.string(),
  asset: z.string(),
  amount: z.string(),
  // Optional: build_catalog fills it with the seller's split contract when the splitter is
  // configured. Supplying a different address is rejected, not silently honoured.
  payTo: z.string().optional(),
  facilitator: z.string().optional(),
  description: z.string().optional(),
});

const contentSpecSchema = z
  .object({
    type: z.enum(['image', 'video', 'audio', 'text', 'document', 'dataset', 'bytes']),
    encodingFormat: z.string(),
  })
  .passthrough();

const sampleSpecSchema = z.object({
  kind: z.enum(['subset', 'clip', 'thumbnail', 'manifest']),
  path: z.string(),
  encodingFormat: z.string().optional(),
  contentSize: z.number().optional(),
});

const swarmStorageSchema = z.object({
  reference: z.string(),
  contentSize: z.number().optional(),
});

const catalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  content: contentSpecSchema,
  storage: swarmStorageSchema,
  payment: z
    .array(paymentRequirementsSchema)
    .min(1, { message: 'payment array must not be empty.' }),
  sample: sampleSpecSchema.optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  lifecycle: z.enum(['active', 'deprecated', 'retired']),
  supersededBy: z.string().optional(),
  dateAdded: z.string(),
  dateModified: z.string(),
});

const buildCatalogItemSchema = z.object({
  item: catalogItemSchema,
  actSeed: z.object({
    actHistoryRef: z.string().min(1),
    granteeRef: z.string().min(1),
  }),
  sampleData: z.string().optional(),
  // How to interpret sampleData before upload. 'utf8' (default) uploads the string
  // bytes as-is; 'base64' decodes to raw bytes first (required for binary samples
  // like PNG thumbnails).
  sampleEncoding: z.enum(['utf8', 'base64']).optional(),
});

export const buildCatalogSchema = z.object({
  items: z.array(buildCatalogItemSchema).min(1, { message: 'Missing required parameter: items.' }),
  catalogMeta: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      license: z.string().optional(),
    })
    .optional(),
  postageBatchId: z.string().optional(),
});

export const getAgentSchema = z.object({
  agentId: z.string().min(1, { message: 'Missing required parameter: agentId.' }),
  includeCatalog: z.boolean().optional(),
});

export const deleteCatalogItemSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1, { message: 'Missing required parameter: itemIds.' }),
  postageBatchId: z.string().optional(),
});

export const deleteCatalogSchema = z.object({
  confirm: z.boolean().optional(),
  postageBatchId: z.string().optional(),
});

export const registerAgentSchema = z.object({
  name: z.string().min(1, { message: 'Missing required parameter: name.' }),
  description: z.string().min(1, { message: 'Missing required parameter: description.' }),
  image: z.string().optional(),
  version: z.string().optional(),
  x402: z.string().optional(),
  // Defaults to the BEE_FEED_PK address. Override only when the catalog feed signer differs
  // from the Agent Card feed signer.
  catalogFeedOwner: z.string().optional(),
  // Accept either a comma-separated string or an array; normalized inside the tool.
  capabilities: z.union([z.string(), z.array(z.string())]).optional(),
  postageBatchId: z.string().optional(),
  // Splitter seller of record. Defaults to AGENT_PAYMENT_ADDRESS, then the PRIVATE_KEY wallet.
  seller: z.string().optional(),
  // Re-publish the Agent Card when its content has drifted from these arguments.
  refreshCard: z.boolean().optional(),
  // Explicit start block for the fallback MetadataSet scan. Without it the adapter only looks
  // back RECENT_BLOCK_COUNT (~13 days on Base Sepolia).
  fromBlock: z.number().int().nonnegative().optional(),
  // Report what would happen without sending a transaction or writing to Swarm.
  dryRun: z.boolean().optional(),
  // Identity-only registration: skip the splitter and the link.
  skipSplitter: z.boolean().optional(),
});

export const findAgentsByMetadataSchema = z
  .object({
    catalogFeedOwner: z.string().optional(),
    metadataKey: z.string().min(1).optional(),
    metadataValue: z.string().optional(),
    fromBlock: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Boolean(v.catalogFeedOwner || v.metadataKey), {
    message: 'Provide either catalogFeedOwner or metadataKey.',
  });

export const getSplitContractSchema = z.object({
  seller: z.string().optional(),
});

export const linkSplitContractSchema = z.object({
  agentId: z.string().min(1, { message: 'Missing required parameter: agentId.' }),
  splitter: z.string().optional(),
  seller: z.string().optional(),
});

export const purchaseCatalogItemSchema = z.object({
  itemId: z.string().min(1, { message: 'Missing required parameter: itemId.' }),
  x402Endpoint: z.string().optional(),
  granteePublicKey: z.string().optional(),
});
