// Happy-path coverage for SwarmCatalogBuilder.publish().
// bee-js is mocked so the flow runs without a live Bee node or real Mantaray.

jest.mock('@ethersphere/bee-js', () => {
  class MantarayNode {
    forks = new Map<string, string>();
    addFork = jest.fn((path: string, ref: string) => {
      this.forks.set(path, ref);
    });
    removeFork = jest.fn((path: string) => {
      this.forks.delete(path);
    });
    find = jest.fn();
    collect = jest.fn(() =>
      Array.from(this.forks.entries()).map(([fullPathString, ref]) => ({
        fullPathString,
        targetAddress: ref,
      })),
    );
    loadRecursively = jest.fn();
    saveRecursively = jest
      .fn()
      .mockResolvedValue({ reference: { toString: () => '1'.repeat(64) } });
    static unmarshal = jest.fn();
  }
  class PrivateKey {
    private readonly key: unknown;
    constructor(key: unknown) {
      this.key = key;
    }
    publicKey() {
      // Derive a deterministic, key-sensitive address so the builder's distinctness check
      // (catalog signer ≠ state signer) behaves like the real implementation.
      const hex = String(this.key).replace(/^0x/, '').padStart(40, '0').slice(-40);
      return { address: () => ({ toHex: () => hex }) };
    }
  }
  return { MantarayNode, PrivateKey };
});

import { MantarayNode } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder } from '../src/builder';
import { itemManifestPath, itemSamplePath } from '../src/paths';
import type { CatalogItem } from '../src/types';

const SIGNER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
// Distinct key for the hot (state feed) signer — the builder enforces the two differ.
const SIGNER2 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const BATCH = 'f'.repeat(64);
const REF = 'a'.repeat(64);
const REF2 = 'b'.repeat(64);
const PREV_ROOT = '9'.repeat(64);
const CATALOG_ROOT = '1'.repeat(64);

function pricedItem(): CatalogItem {
  return {
    id: REF,
    name: 'Priced',
    description: 'desc',
    content: { type: 'text', encodingFormat: 'text/plain' },
    storage: { reference: REF },
    payment: [
      { scheme: 'exact', chainId: 'eip155:84532', asset: 'x', amount: '1000000', payTo: '0xdead' },
    ],
    license: 'MIT',
    sample: { kind: 'subset', path: 'sample/p.txt' },
    lifecycle: 'active',
    dateAdded: '2026-06-01T00:00:00.000Z',
    dateModified: '2026-06-02T00:00:00.000Z',
  };
}

function secondPricedItem(): CatalogItem {
  return { ...pricedItem(), id: REF2, name: 'Priced 2', storage: { reference: REF2 } };
}

interface FakeBeeOpts {
  // When set, the catalog feed read resolves this bare root ⇒ copy-on-write path.
  priorRoot?: string;
  // Bytes returned by bee.downloadData (used by the in-place lifecycle update path).
  downloadData?: jest.Mock;
}

function fakeBee(opts: FakeBeeOpts = {}) {
  const uploadPayload = jest.fn().mockResolvedValue({ reference: { toString: () => 'feedtx' } });
  const uploadData = jest.fn().mockResolvedValue({ reference: { toString: () => 'blobref' } });
  // No priorRoot ⇒ catalog feed read fails ⇒ builder starts from a fresh Mantaray (no unmarshal).
  const downloadPayload =
    opts.priorRoot != null
      ? jest.fn().mockResolvedValue({ payload: { toUtf8: () => opts.priorRoot } })
      : jest.fn().mockRejectedValue(new Error('no prior catalog'));
  const downloadData = opts.downloadData ?? jest.fn();
  return {
    bee: {
      uploadData,
      downloadData,
      makeFeedWriter: jest.fn().mockReturnValue({ uploadPayload }),
      makeFeedReader: jest.fn().mockReturnValue({ downloadPayload }),
    } as never,
    uploadData,
    uploadPayload,
    downloadData,
  };
}

// A mock Mantaray instance returned by MantarayNode.unmarshal in copy-on-write tests,
// so assertions can target the manifest the builder mutates.
function makeManifest() {
  const forks = new Map<string, string>();
  return {
    forks, // exposed so tests can seed prior items before copy-on-write
    addFork: jest.fn((path: string, ref: string) => {
      forks.set(path, ref);
    }),
    removeFork: jest.fn((path: string) => {
      forks.delete(path);
    }),
    find: jest.fn(),
    collect: jest.fn(() =>
      Array.from(forks.entries()).map(([fullPathString, ref]) => ({
        fullPathString,
        targetAddress: ref,
      })),
    ),
    loadRecursively: jest.fn().mockResolvedValue(undefined),
    saveRecursively: jest.fn().mockResolvedValue({ reference: { toString: () => CATALOG_ROOT } }),
  };
}

// Find the uploadData payload that parsed to the collection-level catalog.jsonld doc.
function findCatalogDoc(uploadData: jest.Mock): Record<string, unknown> | undefined {
  for (const call of uploadData.mock.calls) {
    const payload = call[1];
    if (typeof payload !== 'string') continue;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const type = parsed['@type'];
      if (Array.isArray(type) && type.includes('sc:DataCatalog')) return parsed;
    } catch {
      // not JSON (e.g. bare root) — skip
    }
  }
  return undefined;
}

// Wire MantarayNode.unmarshal (a jest.fn from the module mock) to resolve a given manifest.
function stubPriorManifest(manifest: ReturnType<typeof makeManifest>): void {
  (MantarayNode.unmarshal as unknown as jest.Mock).mockResolvedValue(manifest);
}

function makeBuilder(bee: unknown) {
  return new SwarmCatalogBuilder({
    bee: bee as never,
    catalogFeedSigner: SIGNER,
    itemStateFeedSigner: SIGNER2,
    postageBatchId: BATCH,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('publish — happy path', () => {
  it('publishes a priced item and returns root, feed tx, and state feeds', async () => {
    const { bee, uploadData, uploadPayload } = fakeBee();
    const builder = new SwarmCatalogBuilder({
      bee,
      catalogFeedSigner: SIGNER,
      itemStateFeedSigner: SIGNER2,
      postageBatchId: BATCH,
    });

    const item = pricedItem();
    builder.stageItem(item);
    builder.seedActState(REF, { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) });

    const result = await builder.publish();

    expect(result.catalogRoot).toBe(CATALOG_ROOT);
    expect(result.feedUpdateTxId).toBe('feedtx');
    expect(result.stateFeeds).toEqual([{ itemId: REF, reference: 'blobref' }]);

    // item.jsonld + catalog.jsonld + state JSON were uploaded.
    expect(uploadData).toHaveBeenCalled();
    // catalog feed update carries the bare Mantaray root.
    expect(uploadPayload).toHaveBeenCalledWith(BATCH, CATALOG_ROOT);
  });

  it('publishes multiple items with one state feed each', async () => {
    const { bee } = fakeBee();
    const builder = makeBuilder(bee);

    builder.stageItem(pricedItem());
    builder.stageItem(secondPricedItem());
    builder.seedActState(REF, { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) });
    builder.seedActState(REF2, { actHistoryRef: 'f'.repeat(64), granteeRef: 'd'.repeat(64) });

    const result = await builder.publish();

    expect(result.stateFeeds).toEqual([
      { itemId: REF, reference: 'blobref' },
      { itemId: REF2, reference: 'blobref' },
    ]);
  });
});

describe('publish — copy-on-write from a prior catalog', () => {
  it('loads and reuses the previous Mantaray when the feed has a root', async () => {
    const { bee } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageItem(pricedItem());
    builder.seedActState(REF, { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) });

    const result = await builder.publish();

    expect(MantarayNode.unmarshal as unknown as jest.Mock).toHaveBeenCalledWith(bee, PREV_ROOT);
    expect(manifest.loadRecursively).toHaveBeenCalled();
    // The new item is linked into the *existing* manifest (not a fresh one).
    expect(manifest.addFork).toHaveBeenCalledWith(itemManifestPath(REF), 'blobref', null);
    expect(result.catalogRoot).toBe(CATALOG_ROOT);
  });
});

describe('publish — mutation paths', () => {
  function seeded() {
    return { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) };
  }

  it('uploads sample bytes and links the sample fork', async () => {
    const { bee, uploadData } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageItem(pricedItem()); // sample.path === 'sample/p.txt'
    builder.stageSampleData(REF, 'SAMPLE-BYTES');
    builder.seedActState(REF, seeded());

    await builder.publish();

    expect(uploadData).toHaveBeenCalledWith(BATCH, 'SAMPLE-BYTES');
    expect(manifest.addFork).toHaveBeenCalledWith(
      itemSamplePath(REF, 'sample/p.txt'),
      'blobref',
      null,
    );
  });

  it('removes an item fork when staged for removal', async () => {
    const { bee } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageRemove(REF);
    await builder.publish();

    expect(manifest.removeFork).toHaveBeenCalledWith(itemManifestPath(REF));
  });

  it('updates lifecycle in place for an item already in the catalog', async () => {
    const downloadData = jest.fn().mockResolvedValue({
      toUtf8: () => JSON.stringify({ lifecycle: 'active', name: 'X' }),
    });
    const { bee, uploadData } = fakeBee({ priorRoot: PREV_ROOT, downloadData });
    const manifest = makeManifest();
    manifest.find.mockReturnValue({ targetAddress: Uint8Array.from([1, 2, 3]) });
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageLifecycle(REF, 'deprecated');
    await builder.publish();

    expect(manifest.find).toHaveBeenCalledWith(itemManifestPath(REF));
    expect(downloadData).toHaveBeenCalled();
    // Re-uploaded item.jsonld carries the new lifecycle, and its fork is repointed.
    expect(uploadData).toHaveBeenCalledWith(
      BATCH,
      expect.stringContaining('"lifecycle": "deprecated"'),
    );
    expect(manifest.addFork).toHaveBeenCalledWith(itemManifestPath(REF), 'blobref', null);
  });

  it('warns and skips a lifecycle change for an unknown item', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { bee } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    manifest.find.mockReturnValue(undefined); // not present in the catalog
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageLifecycle(REF, 'deprecated');
    await builder.publish();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`unknown item ${REF}`));
    // The unknown item's fork is never repointed (only /catalog.jsonld is written).
    expect(manifest.addFork).not.toHaveBeenCalledWith(
      itemManifestPath(REF),
      expect.anything(),
      expect.anything(),
    );
    warn.mockRestore();
  });
});

describe('publish — catalog.jsonld itemCount (catalog-wide total)', () => {
  function seeded() {
    return { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) };
  }

  it('counts staged items for a fresh catalog', async () => {
    const { bee, uploadData } = fakeBee();
    const builder = makeBuilder(bee);

    builder.stageItem(pricedItem());
    builder.stageItem(secondPricedItem());
    builder.seedActState(REF, seeded());
    builder.seedActState(REF2, seeded());

    await builder.publish();

    expect(findCatalogDoc(uploadData)?.['swarm-cat:itemCount']).toBe(2);
  });

  it('counts carried-over items plus newly staged ones (copy-on-write)', async () => {
    const { bee, uploadData } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    // Prior catalog already contains item A (carried over, NOT re-staged this publish).
    manifest.forks.set(itemManifestPath(REF), 'refA');
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageItem(secondPricedItem()); // add item B
    builder.seedActState(REF2, seeded());

    await builder.publish();

    // staged.size would be 1 (the old bug) — the manifest holds both A and B.
    expect(findCatalogDoc(uploadData)?.['swarm-cat:itemCount']).toBe(2);
  });

  it('reflects removals in the count', async () => {
    const { bee, uploadData } = fakeBee({ priorRoot: PREV_ROOT });
    const manifest = makeManifest();
    manifest.forks.set(itemManifestPath(REF), 'refA');
    manifest.forks.set(itemManifestPath(REF2), 'refB');
    stubPriorManifest(manifest);
    const builder = makeBuilder(bee);

    builder.stageRemove(REF);
    await builder.publish();

    expect(findCatalogDoc(uploadData)?.['swarm-cat:itemCount']).toBe(1);
  });

  it('does not count sample leaves under /items/{id}/', async () => {
    const { bee, uploadData } = fakeBee();
    const builder = makeBuilder(bee);

    builder.stageItem(pricedItem()); // sample.path === 'sample/p.txt'
    builder.stageSampleData(REF, 'SAMPLE-BYTES');
    builder.seedActState(REF, seeded());

    await builder.publish();

    // Manifest has /items/REF/item.jsonld + /items/REF/sample/p.txt — only the former counts.
    expect(findCatalogDoc(uploadData)?.['swarm-cat:itemCount']).toBe(1);
  });
});

describe('setCatalogMeta', () => {
  it('writes name/description/license into catalog.jsonld', async () => {
    const { bee, uploadData } = fakeBee();
    const builder = makeBuilder(bee);
    builder.setCatalogMeta({
      name: 'Acme AI Vision Datasets',
      description: 'Curated training data.',
      license: 'https://example.com/licenses/acme-data-v1',
    });
    builder.stageItem(pricedItem());
    builder.seedActState(REF, { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) });

    await builder.publish();

    const catalogDoc = findCatalogDoc(uploadData);
    expect(catalogDoc).toBeDefined();
    expect(catalogDoc?.name).toBe('Acme AI Vision Datasets');
    expect(catalogDoc?.description).toBe('Curated training data.');
    expect(catalogDoc?.license).toBe('https://example.com/licenses/acme-data-v1');
  });

  it('rejects a URL-shaped license that is not a valid IRI', () => {
    const { bee } = fakeBee();
    const builder = makeBuilder(bee);
    expect(() => builder.setCatalogMeta({ license: 'https://' })).toThrow(/not a valid IRI/);
  });

  it('merges across calls and only writes provided keys', async () => {
    const { bee, uploadData } = fakeBee();
    const builder = makeBuilder(bee);
    builder.setCatalogMeta({ name: 'First' });
    builder.setCatalogMeta({ description: 'Second' });
    builder.stageItem(pricedItem());
    builder.seedActState(REF, { actHistoryRef: 'e'.repeat(64), granteeRef: 'c'.repeat(64) });

    await builder.publish();

    const catalogDoc = findCatalogDoc(uploadData);
    expect(catalogDoc?.name).toBe('First');
    expect(catalogDoc?.description).toBe('Second');
    expect(catalogDoc).not.toHaveProperty('license');
  });
});
