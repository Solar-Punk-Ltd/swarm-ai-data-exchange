import { serializeItem, serializeCatalog } from '../src/jsonld';
import type { CatalogItem, ContentSpec } from '../src/types';

const REF = 'a'.repeat(64);

function baseItem(content: ContentSpec, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: REF,
    name: 'Test Item',
    description: 'A test catalog item',
    content,
    storage: { reference: REF },
    payment: [
      {
        scheme: 'exact',
        chainId: 'eip155:84532',
        asset: 'eip155:84532/erc20:0xUSDC',
        amount: '1000000',
        payTo: '0x000000000000000000000000000000000000dEaD',
      },
    ],
    lifecycle: 'active',
    dateAdded: '2026-06-01T00:00:00.000Z',
    dateModified: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('serializeItem — common envelope', () => {
  const doc = serializeItem(
    baseItem({ type: 'image', encodingFormat: 'image/png', width: 10, height: 20 }),
  );

  it('sets the protocol @context', () => {
    expect(doc['@context']).toBe('https://swarm-ai-catalog.eth/v1');
  });

  it('carries id, name, description and encodingFormat at the top level', () => {
    expect(doc.id).toBe(REF);
    expect(doc.name).toBe('Test Item');
    expect(doc.description).toBe('A test catalog item');
    expect(doc.encodingFormat).toBe('image/png');
  });

  it('serializes storage as a typed SwarmStorage node', () => {
    expect(doc.storage).toEqual({ '@type': 'swarm-cat:SwarmStorage', reference: REF });
  });

  it('maps payment entries with all required fields', () => {
    expect(doc.payment).toEqual([
      {
        '@type': 'swarm-cat:PaymentRequirements',
        scheme: 'exact',
        chainId: 'eip155:84532',
        asset: 'eip155:84532/erc20:0xUSDC',
        amount: '1000000',
        payTo: '0x000000000000000000000000000000000000dEaD',
      },
    ]);
  });

  it('carries lifecycle and dates', () => {
    expect(doc.lifecycle).toBe('active');
    expect(doc.dateAdded).toBe('2026-06-01T00:00:00.000Z');
    expect(doc.dateModified).toBe('2026-06-02T00:00:00.000Z');
  });
});

describe('serializeItem — @type co-typing (§7.4)', () => {
  const cases: Array<[ContentSpec, string[]]> = [
    [
      { type: 'image', encodingFormat: 'image/png', width: 1, height: 1 },
      ['swarm-cat:CatalogItem', 'sc:ImageObject'],
    ],
    [
      { type: 'video', encodingFormat: 'video/mp4', width: 1, height: 1, duration: 'PT1S' },
      ['swarm-cat:CatalogItem', 'sc:VideoObject'],
    ],
    [
      { type: 'audio', encodingFormat: 'audio/mpeg', duration: 'PT1S' },
      ['swarm-cat:CatalogItem', 'sc:AudioObject'],
    ],
    [
      { type: 'text', encodingFormat: 'text/plain' },
      ['swarm-cat:CatalogItem', 'sc:TextDigitalDocument'],
    ],
    [
      { type: 'document', encodingFormat: 'application/pdf' },
      ['swarm-cat:CatalogItem', 'sc:CreativeWork'],
    ],
    [
      { type: 'dataset', encodingFormat: 'text/csv' },
      ['swarm-cat:CatalogItem', 'cr:Dataset', 'sc:Dataset'],
    ],
    [
      { type: 'bytes', encodingFormat: 'application/octet-stream' },
      ['swarm-cat:CatalogItem', 'sc:MediaObject'],
    ],
  ];

  it.each(cases)('co-types %o correctly', (content, expected) => {
    expect(serializeItem(baseItem(content))['@type']).toEqual(expected);
  });
});

describe('serializeItem — schema.org property mapping', () => {
  it('emits width/height/duration/bitrate as bare schema.org names for video', () => {
    const doc = serializeItem(
      baseItem({
        type: 'video',
        encodingFormat: 'video/mp4',
        width: 1920,
        height: 1080,
        duration: 'PT12M34S',
        bitrate: 4500000,
      }),
    );
    expect(doc.width).toBe(1920);
    expect(doc.height).toBe(1080);
    expect(doc.duration).toBe('PT12M34S');
    expect(doc.bitrate).toBe(4500000);
  });

  it('emits wordCount/inLanguage as bare schema.org names for text', () => {
    const doc = serializeItem(
      baseItem({ type: 'text', encodingFormat: 'text/plain', wordCount: 500, inLanguage: 'en' }),
    );
    expect(doc.wordCount).toBe(500);
    expect(doc.inLanguage).toBe('en');
  });
});

describe('serializeItem — swarm-cat: extension properties', () => {
  it('prefixes image colorSpace', () => {
    const doc = serializeItem(
      baseItem({
        type: 'image',
        encodingFormat: 'image/png',
        width: 1,
        height: 1,
        colorSpace: 'sRGB',
      }),
    );
    expect(doc['swarm-cat:colorSpace']).toBe('sRGB');
    expect(doc).not.toHaveProperty('colorSpace');
  });

  it('prefixes video fps/codec/hasAudio', () => {
    const doc = serializeItem(
      baseItem({
        type: 'video',
        encodingFormat: 'video/mp4',
        width: 1,
        height: 1,
        duration: 'PT1S',
        fps: 30,
        codec: 'h264',
        hasAudio: true,
      }),
    );
    expect(doc['swarm-cat:fps']).toBe(30);
    expect(doc['swarm-cat:codec']).toBe('h264');
    expect(doc['swarm-cat:hasAudio']).toBe(true);
  });

  it('prefixes audio channels/sampleRate', () => {
    const doc = serializeItem(
      baseItem({
        type: 'audio',
        encodingFormat: 'audio/wav',
        duration: 'PT1S',
        channels: 2,
        sampleRate: 44100,
      }),
    );
    expect(doc['swarm-cat:channels']).toBe(2);
    expect(doc['swarm-cat:sampleRate']).toBe(44100);
  });

  it('prefixes bytes modelArchitecture/parameters', () => {
    const doc = serializeItem(
      baseItem({
        type: 'bytes',
        encodingFormat: 'application/octet-stream',
        modelArchitecture: 'transformer',
        parameters: 7000000000,
      }),
    );
    expect(doc['swarm-cat:modelArchitecture']).toBe('transformer');
    expect(doc['swarm-cat:parameters']).toBe(7000000000);
  });

  it('prefixes dataset isMultiFile', () => {
    const doc = serializeItem(
      baseItem({ type: 'dataset', encodingFormat: 'text/csv', isMultiFile: true }),
    );
    expect(doc['swarm-cat:isMultiFile']).toBe(true);
  });
});

describe('serializeItem — Croissant record sets', () => {
  it('emits cr:conformsTo + cr:recordSet for a dataset with recordSets', () => {
    const doc = serializeItem(
      baseItem({
        type: 'dataset',
        encodingFormat: 'text/csv',
        recordSets: [{ name: 'rows', fields: [{ name: 'age', dataType: 'sc:Integer' }] }],
      }),
    );
    expect(doc['cr:conformsTo']).toBe('http://mlcommons.org/croissant/1.1');
    expect(doc['cr:recordSet']).toEqual([
      {
        '@type': 'cr:RecordSet',
        name: 'rows',
        field: [{ '@type': 'cr:Field', name: 'age', dataType: 'sc:Integer' }],
      },
    ]);
  });

  it('omits Croissant fields when recordSets is empty or absent', () => {
    const doc = serializeItem(
      baseItem({ type: 'dataset', encodingFormat: 'text/csv', recordSets: [] }),
    );
    expect(doc).not.toHaveProperty('cr:conformsTo');
    expect(doc).not.toHaveProperty('cr:recordSet');
  });
});

describe('serializeItem — optional top-level fields', () => {
  const content: ContentSpec = { type: 'text', encodingFormat: 'text/plain' };

  it('includes sample (with swarm-cat:SampleSpec @type) when present', () => {
    const doc = serializeItem(
      baseItem(content, {
        sample: {
          kind: 'subset',
          path: 'sample/preview.txt',
          encodingFormat: 'text/plain',
          contentSize: 100,
        },
      }),
    );
    expect(doc.sample).toEqual({
      '@type': 'swarm-cat:SampleSpec',
      kind: 'subset',
      path: 'sample/preview.txt',
      encodingFormat: 'text/plain',
      contentSize: 100,
    });
  });

  it('includes license/tags/version when present', () => {
    const doc = serializeItem(
      baseItem(content, { license: 'MIT', tags: ['ml', 'nlp'], version: '1.2.0' }),
    );
    expect(doc.license).toBe('MIT');
    expect(doc.tags).toEqual(['ml', 'nlp']);
    expect(doc.version).toBe('1.2.0');
  });

  it('prefixes supersededBy with swarm-cat:', () => {
    const doc = serializeItem(baseItem(content, { supersededBy: 'b'.repeat(64) }));
    expect(doc['swarm-cat:supersededBy']).toBe('b'.repeat(64));
  });

  it('omits optional fields that are absent', () => {
    const doc = serializeItem(baseItem(content));
    expect(doc).not.toHaveProperty('sample');
    expect(doc).not.toHaveProperty('license');
    expect(doc).not.toHaveProperty('tags');
    expect(doc).not.toHaveProperty('version');
    expect(doc).not.toHaveProperty('swarm-cat:supersededBy');
  });

  it('omits empty tags array', () => {
    const doc = serializeItem(baseItem(content, { tags: [] }));
    expect(doc).not.toHaveProperty('tags');
  });
});

describe('serializeCatalog', () => {
  it('produces a DataCatalog document with item count and protocol version', () => {
    const doc = serializeCatalog(2);
    expect(doc['@context']).toBe('https://swarm-ai-catalog.eth/v1');
    expect(doc['@type']).toEqual(['sc:DataCatalog', 'swarm-cat:Catalog']);
    expect(doc['swarm-cat:itemCount']).toBe(2);
    expect(doc['swarm-cat:protocolVersion']).toBe('1.0');
    expect(typeof doc.dateModified).toBe('string');
  });

  it('reports the item count it is given (zero for an empty catalog)', () => {
    expect(serializeCatalog(0)['swarm-cat:itemCount']).toBe(0);
  });

  it('emits name/description/license when collection meta is provided', () => {
    const doc = serializeCatalog(0, {
      name: 'Acme AI Vision Datasets',
      description: 'Curated training data.',
      license: 'https://example.com/licenses/acme-data-v1',
    });
    expect(doc.name).toBe('Acme AI Vision Datasets');
    expect(doc.description).toBe('Curated training data.');
    expect(doc.license).toBe('https://example.com/licenses/acme-data-v1');
  });

  it('omits name/description/license when meta is absent or empty', () => {
    const doc = serializeCatalog(0);
    expect(doc).not.toHaveProperty('name');
    expect(doc).not.toHaveProperty('description');
    expect(doc).not.toHaveProperty('license');
  });

  it('omits individual meta fields left empty', () => {
    const doc = serializeCatalog(0, { name: 'Only a name' });
    expect(doc.name).toBe('Only a name');
    expect(doc).not.toHaveProperty('description');
    expect(doc).not.toHaveProperty('license');
  });
});
