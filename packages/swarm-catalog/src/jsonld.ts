import type { CatalogItem, ContentSpec } from './types.js';

const CONTEXT = 'https://swarm-ai-catalog.eth/v1';

// Maps ContentSpec.type to JSON-LD @type array per §7.4 co-typing table.
const CONTENT_TYPE_MAP: Record<ContentSpec['type'], string[]> = {
  image: ['swarm-cat:CatalogItem', 'sc:ImageObject'],
  video: ['swarm-cat:CatalogItem', 'sc:VideoObject'],
  audio: ['swarm-cat:CatalogItem', 'sc:AudioObject'],
  text: ['swarm-cat:CatalogItem', 'sc:TextDigitalDocument'],
  document: ['swarm-cat:CatalogItem', 'sc:CreativeWork'],
  dataset: ['swarm-cat:CatalogItem', 'cr:Dataset', 'sc:Dataset'],
  bytes: ['swarm-cat:CatalogItem', 'sc:MediaObject'],
};

// Serialize a CatalogItem to its item.jsonld object.
// Uses schema.org property names where schema.org has them; swarm-cat: prefix for protocol extensions.
// The @context document (https://swarm-ai-catalog.eth/v1) aliases bare names like storage/payment/lifecycle.
export function serializeItem(item: CatalogItem): Record<string, unknown> {
  const content = item.content;
  const doc: Record<string, unknown> = {
    '@context': CONTEXT,
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
    doc['swarm-cat:colorSpace'] = content.colorSpace;
  if ('fps' in content && content.fps != null) doc['swarm-cat:fps'] = content.fps;
  if ('codec' in content && content.codec != null) doc['swarm-cat:codec'] = content.codec;
  if ('hasAudio' in content && content.hasAudio != null)
    doc['swarm-cat:hasAudio'] = content.hasAudio;
  if ('channels' in content && content.channels != null)
    doc['swarm-cat:channels'] = content.channels;
  if ('sampleRate' in content && content.sampleRate != null)
    doc['swarm-cat:sampleRate'] = content.sampleRate;
  if ('isMultiFile' in content && content.isMultiFile != null)
    doc['swarm-cat:isMultiFile'] = content.isMultiFile;
  if ('modelArchitecture' in content && content.modelArchitecture != null)
    doc['swarm-cat:modelArchitecture'] = content.modelArchitecture;
  if ('parameters' in content && content.parameters != null)
    doc['swarm-cat:parameters'] = content.parameters;

  // Croissant 1.1 fields for dataset type
  if (content.type === 'dataset' && content.recordSets && content.recordSets.length > 0) {
    doc['cr:conformsTo'] = 'http://mlcommons.org/croissant/1.1';
    doc['cr:recordSet'] = content.recordSets.map((rs) => ({
      '@type': 'cr:RecordSet',
      name: rs.name,
      field: rs.fields.map((f) => ({
        '@type': 'cr:Field',
        name: f.name,
        dataType: f.dataType,
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
      '@type': 'swarm-cat:SampleSpec',
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
  if (item.supersededBy) doc['swarm-cat:supersededBy'] = item.supersededBy;
  doc.dateAdded = item.dateAdded;
  doc.dateModified = item.dateModified;

  return doc;
}

// Serialize the collection-level catalog.jsonld document (§5.2).
// Carries no agent-identity fields — agent attribution lives in the Agent Card (§3.4).
export function serializeCatalog(items: CatalogItem[]): Record<string, unknown> {
  return {
    '@context': CONTEXT,
    '@type': ['sc:DataCatalog', 'swarm-cat:Catalog'],
    'swarm-cat:itemCount': items.length,
    'swarm-cat:protocolVersion': '1.0',
    dateModified: new Date().toISOString(),
  };
}
