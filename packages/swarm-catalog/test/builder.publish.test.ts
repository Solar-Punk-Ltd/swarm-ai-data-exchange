// Happy-path coverage for SwarmCatalogBuilder.publish().
// bee-js is mocked so the flow runs without a live Bee node or real Mantaray.

jest.mock('@ethersphere/bee-js', () => {
  class MantarayNode {
    addFork = jest.fn();
    removeFork = jest.fn();
    find = jest.fn();
    loadRecursively = jest.fn();
    saveRecursively = jest
      .fn()
      .mockResolvedValue({ reference: { toString: () => '1'.repeat(64) } });
    static unmarshal = jest.fn();
  }
  class PrivateKey {
    constructor(_key: unknown) {}
    publicKey() {
      return { address: () => ({ toHex: () => '00'.repeat(20) }) };
    }
  }
  return { MantarayNode, PrivateKey };
});

import { MantarayNode } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder } from '../src/builder';
import { itemManifestPath, itemSamplePath } from '../src/paths';
import type { CatalogItem } from '../src/types';

const SIGNER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
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
  return {
    addFork: jest.fn(),
    removeFork: jest.fn(),
    find: jest.fn(),
    loadRecursively: jest.fn().mockResolvedValue(undefined),
    saveRecursively: jest.fn().mockResolvedValue({ reference: { toString: () => CATALOG_ROOT } }),
  };
}

// Wire MantarayNode.unmarshal (a jest.fn from the module mock) to resolve a given manifest.
function stubPriorManifest(manifest: ReturnType<typeof makeManifest>): void {
  (MantarayNode.unmarshal as unknown as jest.Mock).mockResolvedValue(manifest);
}

function makeBuilder(bee: unknown) {
  return new SwarmCatalogBuilder({
    bee: bee as never,
    catalogFeedSigner: SIGNER,
    itemStateFeedSigner: SIGNER,
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
      itemStateFeedSigner: SIGNER,
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

  it('writes no state feed for a free item (no ACT seed)', async () => {
    const { bee } = fakeBee();
    const builder = new SwarmCatalogBuilder({
      bee,
      catalogFeedSigner: SIGNER,
      itemStateFeedSigner: SIGNER,
      postageBatchId: BATCH,
    });

    // A free item has an empty payment array, so the priced-item ACT-seed guard does not apply.
    const free = { ...pricedItem(), payment: [] as CatalogItem['payment'] };
    // stageItem would reject empty payment (§12.3), so inject directly into the staged map.
    (builder as unknown as { staged: Map<string, CatalogItem> }).staged.set(REF, free);

    const result = await builder.publish();
    expect(result.stateFeeds).toEqual([]);
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
