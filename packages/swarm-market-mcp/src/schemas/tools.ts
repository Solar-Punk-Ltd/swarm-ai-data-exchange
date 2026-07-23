// JSON-Schema tool descriptions advertised to MCP clients in ListTools.
// Keep in sync with the Zod schemas in ./zod-schemas.ts (runtime validation).

const paymentRequirementsSchema = {
  type: 'object',
  properties: {
    scheme: { type: 'string', enum: ['exact'] },
    chainId: { type: 'string', description: 'CAIP-2 chain id.' },
    asset: { type: 'string', description: 'CAIP-19 asset id.' },
    amount: { type: 'string', description: 'Smallest-unit decimal string.' },
    payTo: { type: 'string', description: '0x payee address.' },
    facilitator: { type: 'string', description: 'Facilitator URL.' },
    description: { type: 'string' },
  },
  required: ['scheme', 'chainId', 'asset', 'amount', 'payTo'],
};

const catalogItemSchema = {
  type: 'object',
  description:
    'A CatalogItem (swarm-catalog). id MUST equal storage.reference; payment MUST be non-empty.',
  properties: {
    id: { type: 'string', description: '64-char hex content reference.' },
    name: { type: 'string' },
    description: { type: 'string' },
    content: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['image', 'video', 'audio', 'text', 'document', 'dataset', 'bytes'],
        },
        encodingFormat: { type: 'string', description: 'MIME type.' },
      },
      required: ['type', 'encodingFormat'],
    },
    storage: {
      type: 'object',
      properties: {
        reference: { type: 'string' },
        contentSize: { type: 'number' },
      },
      required: ['reference'],
    },
    payment: { type: 'array', items: paymentRequirementsSchema, minItems: 1 },
    sample: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['subset', 'clip', 'thumbnail', 'manifest'],
        },
        path: { type: 'string' },
        encodingFormat: { type: 'string' },
        contentSize: { type: 'number' },
      },
      required: ['kind', 'path'],
    },
    license: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    version: { type: 'string' },
    lifecycle: {
      type: 'string',
      enum: ['active', 'deprecated', 'retired'],
    },
    supersededBy: { type: 'string' },
    dateAdded: { type: 'string', description: 'ISO 8601.' },
    dateModified: { type: 'string', description: 'ISO 8601.' },
  },
  required: [
    'id',
    'name',
    'description',
    'content',
    'storage',
    'payment',
    'lifecycle',
    'dateAdded',
    'dateModified',
  ],
};

export const SwarmMarketToolsSchema = [
  {
    name: 'build_catalog',
    title: 'Build catalog',
    description:
      'Publish a catalog of priced, ACT-protected AI data assets to Swarm. ' +
      'Stages one or more CatalogItems and publishes them: uploads samples + item.jsonld + ' +
      'catalog.jsonld, builds/updates the catalog Mantaray, pushes the catalog feed, and ' +
      'initializes each per-item state feed. ' +
      "ACT wrapping is NOT done here: upload + ACT-wrap content first (e.g. via swarm-mcp's " +
      'upload_data with act: true, optionally combined with create_grantees / patch_grantees), ' +
      "then pass the captured actHistoryRef + granteeRef in each item's actSeed.",
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          description: 'Items to stage and publish.',
          items: {
            type: 'object',
            properties: {
              item: catalogItemSchema,
              actSeed: {
                type: 'object',
                description:
                  'ACT refs captured when ACT-wrapping the content (required for every priced item).',
                properties: {
                  actHistoryRef: { type: 'string' },
                  granteeRef: { type: 'string' },
                },
                required: ['actHistoryRef', 'granteeRef'],
              },
              sampleData: {
                type: 'string',
                description:
                  "Optional sample bytes uploaded and linked under the item's sample path. " +
                  'Interpreted per sampleEncoding (utf-8 by default).',
              },
              sampleEncoding: {
                type: 'string',
                enum: ['utf8', 'base64'],
                description:
                  "How to interpret sampleData: 'utf8' (default) or 'base64' for binary samples (e.g. PNG thumbnails).",
              },
            },
            required: ['item', 'actSeed'],
          },
        },
        catalogMeta: {
          type: 'object',
          description: 'Optional collection-level metadata for /catalog.jsonld.',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            license: { type: 'string' },
          },
        },
        postageBatchId: {
          type: 'string',
          description: 'Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.',
        },
      },
      required: ['items'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        catalogRoot: {
          type: 'string',
          description: 'New Mantaray root reference.',
        },
        feedUpdateTxId: {
          type: 'string',
          description: 'Catalog feed update reference.',
        },
        stateFeeds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              reference: { type: 'string' },
            },
            required: ['itemId', 'reference'],
          },
        },
        message: { type: 'string' },
      },
      required: ['catalogRoot', 'feedUpdateTxId', 'stateFeeds'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'get_agent',
    title: 'Get agent',
    description:
      'Resolve an ERC-8004 agent id to its on-chain Agent Card (read-only). When ' +
      'includeCatalog is true, also resolves the agent\'s "swarm-ai-catalog" service entry ' +
      'to its catalog feed owner and enumerates the catalog items (id, name, lifecycle, ' +
      'payment, tags). Returns { agentId, agentURI, agentCard, catalog? }.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'ERC-8004 NFT token id of the agent.',
        },
        includeCatalog: {
          type: 'boolean',
          description: "Also resolve the agent's catalog feed and list its items.",
        },
      },
      required: ['agentId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        agentURI: { type: 'string', description: 'Swarm feed URL of the Agent Card.' },
        agentCard: { type: 'object', description: 'The fetched ERC-8004 Agent Card.' },
        catalog: {
          type: ['object', 'null'],
          description: 'Present only when includeCatalog is true.',
          properties: {
            owner: { type: 'string', description: 'Catalog feed owner address.' },
            name: { type: 'string' },
            description: { type: 'string' },
            license: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  contentType: { type: 'string' },
                  lifecycle: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  payment: { type: 'array' },
                  hasSample: { type: 'boolean' },
                },
                required: ['itemId', 'name', 'lifecycle', 'payment'],
              },
            },
            error: { type: 'string', description: 'Set when the catalog feed is unreadable.' },
          },
          required: ['owner', 'items'],
        },
        catalogNote: { type: 'string' },
      },
      required: ['agentId', 'agentURI', 'agentCard'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'delete_catalog_item',
    title: 'Delete catalog item',
    description:
      'Remove one or more items from the Swarm catalog. Stages a removal per itemId and ' +
      'publishes: copy-on-writes a new catalog Mantaray with the /items/{itemId}/ forks ' +
      'dropped and pushes the catalog feed update. Swarm chunks are immutable, so this does ' +
      'not erase uploaded content — it makes the catalog feed resolve to a Mantaray that no ' +
      'longer references the removed items. To empty the whole catalog, pass every itemId.',
    inputSchema: {
      type: 'object',
      properties: {
        itemIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: '64-char hex content references of the items to remove.',
        },
        postageBatchId: {
          type: 'string',
          description: 'Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.',
        },
      },
      required: ['itemIds'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        catalogRoot: {
          type: 'string',
          description: 'New Mantaray root reference.',
        },
        feedUpdateTxId: {
          type: 'string',
          description: 'Catalog feed update reference.',
        },
        stateFeeds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              reference: { type: 'string' },
            },
            required: ['itemId', 'reference'],
          },
        },
        message: { type: 'string' },
      },
      required: ['catalogRoot', 'feedUpdateTxId', 'stateFeeds'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'delete_catalog',
    title: 'Delete catalog',
    description:
      'Empty the entire catalog. Derives the catalog feed owner from the catalog feed signer ' +
      '(BEE_FEED_PK), enumerates every item in the current Mantaray, removes them all, and ' +
      'pushes a feed update pointing at an emptied catalog. Swarm feeds cannot be truly ' +
      'deleted and chunks are immutable — this leaves the feed resolving to a catalog with no ' +
      'items. Destructive: requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description:
            'Must be true to proceed. Safety latch against accidentally wiping the catalog.',
        },
        postageBatchId: {
          type: 'string',
          description: 'Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        catalogRoot: { type: 'string', description: 'New (emptied) Mantaray root reference.' },
        feedUpdateTxId: { type: 'string', description: 'Catalog feed update reference.' },
        stateFeeds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              reference: { type: 'string' },
            },
            required: ['itemId', 'reference'],
          },
        },
        owner: { type: 'string', description: 'Catalog feed owner address.' },
        removed: { type: 'number', description: 'Number of items removed.' },
        message: { type: 'string' },
      },
      required: ['message'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'purchase_catalog_item',
    title: 'Purchase catalog item',
    description:
      "Buy an ACT-protected catalog item via the seller's x402 server. Runs the two-phase " +
      'x402 flow: fetches the 402 payment challenge, signs an EIP-712 PurchaseIntent plus an ' +
      'ERC-3009 TransferWithAuthorization (shared nonce + time window) with the buyer wallet ' +
      '(BUYER_WALLET_PK), and settles with an X-Payment envelope. The grantee defaults to this ' +
      "Bee node's ACT publisher key so the granted content is decryptable by the same node. " +
      'Returns { txHash, actHistoryRef, grantorPublicKey } for a subsequent download_files_act.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: '64-char hex content reference of the item to buy.',
        },
        x402Endpoint: {
          type: 'string',
          description:
            "Seller's x402 base URL (e.g. https://seller/v1). Falls back to X402_ENDPOINT env.",
        },
        granteePublicKey: {
          type: 'string',
          description:
            "Override the grantee public key; defaults to this node's ACT publisher key.",
        },
      },
      required: ['itemId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        granteePublicKey: { type: 'string' },
        txHash: { type: 'string', description: 'Settlement transaction hash.' },
        actHistoryRef: { type: 'string', description: 'ACT history reference of the grant.' },
        grantorPublicKey: {
          type: 'string',
          description: 'Publisher (grantor) public key needed to decrypt the content.',
        },
        message: { type: 'string' },
      },
      required: ['itemId', 'granteePublicKey'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
];
