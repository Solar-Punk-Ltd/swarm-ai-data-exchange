import type { CatalogItem, ContentType } from './types';
import {
  CROISSANT_CONFORMS_TO,
  CR_DATASET,
  CR_RECORD_SET,
  CR_FIELD,
  CR_CONFORMS_TO,
  CR_RECORD_SET_PROP,
  CR_FIELD_PROP,
  CR_DATA_TYPE_PROP,
} from './schemas/croissant';
import {
  SWARM_CAT_CONTEXT,
  SWARM_CAT_PROTOCOL_VERSION,
  SWARM_CAT_CATALOG_ITEM,
  SWARM_CAT_SAMPLE_SPEC,
  SWARM_CAT_CATALOG,
  SWARM_CAT_COLOR_SPACE,
  SWARM_CAT_FPS,
  SWARM_CAT_CODEC,
  SWARM_CAT_HAS_AUDIO,
  SWARM_CAT_CHANNELS,
  SWARM_CAT_SAMPLE_RATE,
  SWARM_CAT_IS_MULTI_FILE,
  SWARM_CAT_MODEL_ARCHITECTURE,
  SWARM_CAT_PARAMETERS,
  SWARM_CAT_SUPERSEDED_BY,
  SWARM_CAT_ITEM_COUNT,
  SWARM_CAT_PROTOCOL_VERSION_PROP,
} from './schemas/swarmCat';
import {
  SC_IMAGE_OBJECT,
  SC_VIDEO_OBJECT,
  SC_AUDIO_OBJECT,
  SC_TEXT_DIGITAL_DOCUMENT,
  SC_CREATIVE_WORK,
  SC_DATASET,
  SC_MEDIA_OBJECT,
  SC_DATA_CATALOG,
} from './schemas/schemaOrg';

const CONTENT_TYPE_MAP: Record<ContentType, string[]> = {
  image: [SWARM_CAT_CATALOG_ITEM, SC_IMAGE_OBJECT],
  video: [SWARM_CAT_CATALOG_ITEM, SC_VIDEO_OBJECT],
  audio: [SWARM_CAT_CATALOG_ITEM, SC_AUDIO_OBJECT],
  text: [SWARM_CAT_CATALOG_ITEM, SC_TEXT_DIGITAL_DOCUMENT],
  document: [SWARM_CAT_CATALOG_ITEM, SC_CREATIVE_WORK],
  dataset: [SWARM_CAT_CATALOG_ITEM, CR_DATASET, SC_DATASET],
  bytes: [SWARM_CAT_CATALOG_ITEM, SC_MEDIA_OBJECT],
};

// Serialize a CatalogItem to its item.jsonld object.
// Uses schema.org property names where schema.org has them; swarm-cat: prefix for protocol extensions.
// The @context document (https://swarm-ai-catalog.eth/v1) aliases bare names like storage/payment/lifecycle.
export function serializeItem(item: CatalogItem): Record<string, unknown> {
  const content = item.content;
  const doc: Record<string, unknown> = {
    '@context': SWARM_CAT_CONTEXT,
    '@type': CONTENT_TYPE_MAP[content.type],
    id: item.id,
    name: item.name,
    description: item.description,
    encodingFormat: content.encodingFormat,
  };

  // schema.org fields present on multiple content types
  if ('width' in content) doc.width = content.width;
  if ('height' in content) doc.height = content.height;
  if ('duration' in content) doc.duration = content.duration;
  if ('contentSize' in content && content.contentSize != null)
    doc.contentSize = content.contentSize;
  if ('bitrate' in content && content.bitrate != null) doc.bitrate = content.bitrate;
  if ('wordCount' in content && content.wordCount != null) doc.wordCount = content.wordCount;
  if ('inLanguage' in content && content.inLanguage != null) doc.inLanguage = content.inLanguage;

  // swarm-cat: extension properties (not in schema.org)
  if ('colorSpace' in content && content.colorSpace != null)
    doc[SWARM_CAT_COLOR_SPACE] = content.colorSpace;
  if ('fps' in content && content.fps != null) doc[SWARM_CAT_FPS] = content.fps;
  if ('codec' in content && content.codec != null) doc[SWARM_CAT_CODEC] = content.codec;
  if ('hasAudio' in content && content.hasAudio != null)
    doc[SWARM_CAT_HAS_AUDIO] = content.hasAudio;
  if ('channels' in content && content.channels != null) doc[SWARM_CAT_CHANNELS] = content.channels;
  if ('sampleRate' in content && content.sampleRate != null)
    doc[SWARM_CAT_SAMPLE_RATE] = content.sampleRate;
  if ('isMultiFile' in content && content.isMultiFile != null)
    doc[SWARM_CAT_IS_MULTI_FILE] = content.isMultiFile;
  if ('modelArchitecture' in content && content.modelArchitecture != null)
    doc[SWARM_CAT_MODEL_ARCHITECTURE] = content.modelArchitecture;
  if ('parameters' in content && content.parameters != null)
    doc[SWARM_CAT_PARAMETERS] = content.parameters;

  // Croissant 1.1 fields for dataset type
  if (content.type === 'dataset' && content.recordSets && content.recordSets.length > 0) {
    doc[CR_CONFORMS_TO] = CROISSANT_CONFORMS_TO;
    doc[CR_RECORD_SET_PROP] = content.recordSets.map((rs) => ({
      '@type': CR_RECORD_SET,
      name: rs.name,
      [CR_FIELD_PROP]: rs.fields.map((f) => ({
        '@type': CR_FIELD,
        name: f.name,
        [CR_DATA_TYPE_PROP]: f.dataType,
      })),
    }));
  }

  // Protocol fields (aliased in @context, use bare names matching spec examples)
  doc.storage = { reference: item.storage.reference };
  doc.payment = item.payment.map((p) => {
    const entry: Record<string, unknown> = {
      scheme: p.scheme,
      chainId: p.chainId,
      asset: p.asset,
      amount: p.amount,
      payTo: p.payTo,
    };
    if (p.facilitator) entry.facilitator = p.facilitator;
    if (p.description) entry.description = p.description;
    return entry;
  });
  doc.lifecycle = item.lifecycle;

  if (item.sample) {
    const sampleDoc: Record<string, unknown> = {
      '@type': SWARM_CAT_SAMPLE_SPEC,
      kind: item.sample.kind,
      path: item.sample.path,
    };
    if (item.sample.encodingFormat) sampleDoc.encodingFormat = item.sample.encodingFormat;
    if (item.sample.contentSize != null) sampleDoc.contentSize = item.sample.contentSize;
    doc.sample = sampleDoc;
  }

  if (item.license) doc.license = item.license;
  if (item.tags && item.tags.length > 0) doc.tags = item.tags;
  if (item.version) doc.version = item.version;
  if (item.supersededBy) doc[SWARM_CAT_SUPERSEDED_BY] = item.supersededBy;
  doc.dateAdded = item.dateAdded;
  doc.dateModified = item.dateModified;

  return doc;
}

// Serialize the collection-level catalog.jsonld document (§5.2).
// Carries no agent-identity fields — agent attribution lives in the Agent Card (§3.4).
export function serializeCatalog(items: CatalogItem[]): Record<string, unknown> {
  return {
    '@context': SWARM_CAT_CONTEXT,
    '@type': [SC_DATA_CATALOG, SWARM_CAT_CATALOG],
    [SWARM_CAT_ITEM_COUNT]: items.length,
    [SWARM_CAT_PROTOCOL_VERSION_PROP]: SWARM_CAT_PROTOCOL_VERSION,
    dateModified: new Date().toISOString(),
  };
}
