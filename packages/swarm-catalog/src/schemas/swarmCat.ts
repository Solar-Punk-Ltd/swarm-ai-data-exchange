// swarm-cat: protocol vocabulary for the Swarm AI Data Exchange catalog.
// The reader side (catalogue-feed-browser, x402-swarm-server) parses these same
// field names back out of item.jsonld / catalog.jsonld, so this is the single
// source of truth shared between the serialize and parse sides.

// JSON-LD @context document for all catalog leaves.
export const SWARM_CAT_CONTEXT = 'https://swarm-ai-catalog.eth/v1';

// Protocol version value carried in catalog.jsonld.
export const SWARM_CAT_PROTOCOL_VERSION = '1.0';

// JSON-LD @type values
export const SWARM_CAT_CATALOG_ITEM = 'swarm-cat:CatalogItem';
export const SWARM_CAT_SAMPLE_SPEC = 'swarm-cat:SampleSpec';
export const SWARM_CAT_CATALOG = 'swarm-cat:Catalog';

// JSON-LD property names (extensions not in schema.org)
export const SWARM_CAT_COLOR_SPACE = 'swarm-cat:colorSpace';
export const SWARM_CAT_FPS = 'swarm-cat:fps';
export const SWARM_CAT_CODEC = 'swarm-cat:codec';
export const SWARM_CAT_HAS_AUDIO = 'swarm-cat:hasAudio';
export const SWARM_CAT_CHANNELS = 'swarm-cat:channels';
export const SWARM_CAT_SAMPLE_RATE = 'swarm-cat:sampleRate';
export const SWARM_CAT_IS_MULTI_FILE = 'swarm-cat:isMultiFile';
export const SWARM_CAT_MODEL_ARCHITECTURE = 'swarm-cat:modelArchitecture';
export const SWARM_CAT_PARAMETERS = 'swarm-cat:parameters';
export const SWARM_CAT_SUPERSEDED_BY = 'swarm-cat:supersededBy';
export const SWARM_CAT_ITEM_COUNT = 'swarm-cat:itemCount';
export const SWARM_CAT_PROTOCOL_VERSION_PROP = 'swarm-cat:protocolVersion';
