// JSON-Schema tool descriptions advertised to MCP clients in ListTools.
// Keep in sync with the Zod schemas in ./zod-schemas.ts (runtime validation).

const paymentRequirementsSchema = {
  type: 'object',
  properties: {
    scheme: { type: 'string', enum: ['exact'] },
    chainId: { type: 'string', description: 'CAIP-2 chain id.' },
    asset: { type: 'string', description: 'CAIP-19 asset id.' },
    amount: { type: 'string', description: 'Smallest-unit decimal string.' },
    payTo: {
      type: 'string',
      description:
        "0x payee address. Omit to use the seller's split contract (requires " +
        'SPLITTER_FACTORY_ADDRESS + AGENT_PAYMENT_ADDRESS). Supplying any other address is rejected: ' +
        'settling outside the splitter is untaxed and earns no Proof-of-Purchase.',
    },
    facilitator: { type: 'string', description: 'Facilitator URL.' },
    description: { type: 'string' },
  },
  required: ['scheme', 'chainId', 'asset', 'amount'],
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
            unreadableItems: {
              type: 'array',
              description:
                'Items present in the Mantaray whose chunk could not be fetched (e.g. stamped ' +
                'by an expired postage batch). Omitted when every leaf resolved.',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  error: { type: 'string' },
                },
                required: ['itemId', 'error'],
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
    name: 'register_agent',
    title: 'Register agent',
    description:
      'Idempotent, convergent seller-agent onboarding — safe to call on EVERY agent startup. ' +
      'Converges on the correct state rather than creating anything unconditionally. ' +
      "Discovers the agent's existing ERC-8004 NFT from the deterministic Agent Card feed " +
      'owned by BEE_FEED_PK (no block-range scan needed), verifying NFT ownership ' +
      '(ownerOf == PRIVATE_KEY signer), tokenURI feed ownership, and the card registrations[] ' +
      'back-reference; falls back to a swarm_agent_id MetadataSet scan. Mints ONLY when no ' +
      'candidate exists and discovery itself succeeded. Repairs a card that fails only the ' +
      "back-reference check instead of minting a duplicate. Then ensures the seller's " +
      'RevenueSplitter clone exists and binds it to the agent under the agent_splitter ' +
      'registry key. Replaces create_agent and create_split_contract. Reports per-step ' +
      'outcomes in identity/splitter/link: identity failures are fatal, splitter failures are ' +
      'reported, link failures are always non-fatal. Set dryRun true to report what would ' +
      'happen without spending gas.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable agent name.' },
        description: { type: 'string', description: 'Short description of what the agent does.' },
        image: { type: 'string', description: 'Optional avatar image URL.' },
        version: {
          type: 'string',
          description: 'SemVer or date string for the Agent Card revision. Defaults to 1.0.0.',
        },
        x402: {
          type: 'string',
          description: 'x402 service endpoint URL; sets x402Support: true on the card.',
        },
        catalogFeedOwner: {
          type: 'string',
          description:
            'Catalog feed owner address. Defaults to the BEE_FEED_PK address — override only ' +
            'when the catalog feed signer differs from the Agent Card feed signer.',
        },
        capabilities: {
          oneOf: [
            { type: 'string', description: 'Comma-separated tags, e.g. "trading,price-feeds".' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        postageBatchId: {
          type: 'string',
          description: 'Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.',
        },
        seller: {
          type: 'string',
          description:
            'Splitter seller of record. Defaults to AGENT_PAYMENT_ADDRESS, then the PRIVATE_KEY wallet.',
        },
        refreshCard: {
          type: 'boolean',
          description:
            'Re-publish the Agent Card when its content has drifted from these arguments. Default true.',
        },
        fromBlock: {
          type: 'number',
          description:
            'Explicit start block for the fallback MetadataSet scan. Without it the adapter only ' +
            'looks back RECENT_BLOCK_COUNT (~13 days on Base Sepolia).',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Report what would happen without sending any transaction or Swarm write. Statuses ' +
            'come back as would-mint / would-repair / would-deploy / would-link.',
        },
        skipSplitter: {
          type: 'boolean',
          description: 'Identity-only registration: skip the splitter and the link entirely.',
        },
      },
      required: ['name', 'description'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        feedOwner: { type: 'string' },
        signer: { type: 'string' },
        chain: { type: 'string' },
        dryRun: { type: 'boolean' },
        identity: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'existing | refreshed | repaired | minted | incomplete | failed | would-*. ' +
                'incomplete means the mint landed but the card write did not — agentId IS ' +
                'present and a re-run will repair rather than mint again.',
            },
            agentId: { type: ['string', 'null'] },
            agentURI: {
              type: 'string',
              description: 'Deterministic; known even when agentId is null.',
            },
            txHash: { type: 'string' },
            cardReference: { type: 'string' },
            verified: {
              type: 'boolean',
              description: 'The single boolean a caller should gate on.',
            },
            metadataStatus: { type: 'string' },
            metadataTxHash: { type: 'string' },
            candidatesScanned: { type: 'number' },
            candidates: { type: 'array', items: { type: 'object' } },
            discoveryError: {
              type: 'string',
              description: 'Discovery threw rather than returning empty; the mint was suppressed.',
            },
            error: { type: 'string' },
          },
          required: [
            'status',
            'agentId',
            'agentURI',
            'verified',
            'metadataStatus',
            'candidatesScanned',
          ],
        },
        splitter: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'existing | deployed | unconfigured | failed | skipped | would-deploy.',
            },
            address: { type: ['string', 'null'], description: 'Clone address to use as payTo.' },
            seller: { type: ['string', 'null'] },
            factory: { type: ['string', 'null'] },
            treasury: { type: 'string' },
            taxBps: { type: 'number' },
            txHash: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['status', 'address', 'seller', 'factory'],
        },
        link: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'linked | already-linked | repointed | skipped | failed | would-link. Never fatal.',
            },
            metadataKey: { type: 'string' },
            splitter: { type: ['string', 'null'] },
            previousSplitter: { type: 'string' },
            txHash: { type: 'string' },
            reason: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['status', 'metadataKey', 'splitter'],
        },
        warnings: { type: 'array', items: { type: 'string' } },
        message: { type: 'string' },
      },
      required: ['feedOwner', 'signer', 'chain', 'dryRun', 'identity', 'splitter', 'link'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'find_agents_by_metadata',
    title: 'Find agents by metadata',
    description:
      'Scan ERC-8004 MetadataSet events and return matching agents (agentId, tokenURI, ' +
      'NFT owner, utf-8-decoded metadata value). Intended as a fast index for "find my ' +
      'agent" lookups on startup. Callers MUST still verify feed ownership and NFT ' +
      'ownership before trusting a match — metadata is spoofable. Prefer the ' +
      'catalogFeedOwner input over raw metadataKey when locating an agent by its catalog ' +
      'feed identity.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogFeedOwner: {
          type: 'string',
          description:
            'Semantic filter: catalog feed owner address (0x-prefixed EOA). Under the hood, ' +
            'scans the swarm_agent_id metadata key for a case-insensitive match.',
        },
        metadataKey: {
          type: 'string',
          description:
            'Raw metadata key to scan (e.g. "swarm_ai_capable"). Required when ' +
            'catalogFeedOwner is not provided.',
        },
        metadataValue: {
          type: 'string',
          description: 'Optional utf-8 filter for raw mode. Ignored when catalogFeedOwner is set.',
        },
        fromBlock: {
          type: 'number',
          description: 'Optional starting block for the event scan. Defaults to a recent window.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        metadataKey: { type: 'string' },
        agents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agentId: { type: 'string' },
              agentURI: { type: 'string' },
              owner: { type: 'string', description: 'On-chain NFT owner address.' },
              metadataValue: { type: 'string' },
            },
            required: ['agentId', 'agentURI', 'owner', 'metadataValue'],
          },
        },
      },
      required: ['metadataKey', 'agents'],
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
  {
    name: 'get_split_contract',
    title: 'Get seller split contract',
    description:
      "Read the seller's RevenueSplitter clone address and its frozen terms. Read-only — no " +
      'signer, no gas. Returns splitter null and deployed false when the seller has not created ' +
      'one yet; the address cannot be derived off-chain, so there is nothing to report until ' +
      'register_agent has run.',
    inputSchema: {
      type: 'object',
      properties: {
        seller: {
          type: 'string',
          description: '0x seller address. Defaults to AGENT_PAYMENT_ADDRESS.',
        },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        splitter: {
          type: ['string', 'null'],
          description: 'Clone address to use as payTo, or null if the seller has no clone.',
        },
        seller: { type: 'string' },
        factory: { type: 'string' },
        deployed: { type: 'boolean', description: 'Whether the seller has a clone on-chain.' },
        treasury: { type: 'string', description: "Treasury frozen into the clone's terms." },
        taxBps: { type: 'number', description: 'Sales tax in basis points (500 = 5%).' },
        note: { type: 'string', description: 'Next step, when no clone exists yet.' },
      },
      required: ['splitter', 'seller', 'factory', 'deployed'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
  {
    name: 'link_split_contract',
    title: 'Link split contract to ERC-8004 agent',
    description:
      'Bind an ERC-8004 agent to its RevenueSplitter clone by writing the clone address into ' +
      'the Identity Registry under the agent_splitter metadata key. This is what lets indexers ' +
      'and dashboards resolve agent -> splitter in one read, and splitter -> agent in one ' +
      'indexed log query. The link lives in the registry rather than in the clone because ' +
      'createSplitter is permissionless (a clone-held agentId would be unauthenticated) and ' +
      'clone terms are frozen while NFT ownership can transfer. Sends a transaction; the ' +
      'PRIVATE_KEY signer must own the agent NFT. Re-run to re-point the link.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'ERC-8004 agent id (NFT token id). The signer must own this NFT.',
        },
        splitter: {
          type: 'string',
          description:
            "0x clone address to link. Omit to resolve the seller's clone from the factory.",
        },
        seller: {
          type: 'string',
          description:
            'Seller whose clone to resolve when splitter is omitted. Defaults to AGENT_PAYMENT_ADDRESS.',
        },
      },
      required: ['agentId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        splitter: { type: 'string', description: 'Clone address now bound to the agent.' },
        seller: { type: 'string', description: 'Seller the clone was resolved from, if any.' },
        factory: { type: 'string' },
        txHash: {
          type: 'string',
          description: 'Empty when the agent already pointed at this splitter.',
        },
        metadataKey: { type: 'string', description: 'Registry key written (agent_splitter).' },
        alreadyLinked: {
          type: 'boolean',
          description: 'True when no transaction was needed.',
        },
        note: { type: 'string' },
      },
      required: ['agentId', 'splitter', 'txHash', 'metadataKey', 'alreadyLinked'],
    },
    execution: {
      taskSupport: 'forbidden',
    },
  },
];
