import { z } from 'zod';

// Deep field validation (id === storage.reference, required content fields, IRI checks)
// is performed by SwarmCatalogBuilder.stageItem. These schemas validate shape only.

const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  chainId: z.string(),
  asset: z.string(),
  amount: z.string(),
  payTo: z.string(),
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
