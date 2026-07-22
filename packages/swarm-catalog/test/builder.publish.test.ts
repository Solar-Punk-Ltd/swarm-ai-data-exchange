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

import { SwarmCatalogBuilder } from '../src/builder.js';
import type { CatalogItem } from '../src/types.js';

const SIGNER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BATCH = 'f'.repeat(64);
const REF = 'a'.repeat(64);
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

function fakeBee() {
  const uploadPayload = jest.fn().mockResolvedValue({ reference: { toString: () => 'feedtx' } });
  const uploadData = jest.fn().mockResolvedValue({ reference: { toString: () => 'blobref' } });
  // Catalog feed read fails ⇒ builder starts from a fresh Mantaray (no unmarshal).
  const downloadPayload = jest.fn().mockRejectedValue(new Error('no prior catalog'));
  return {
    bee: {
      uploadData,
      makeFeedWriter: jest.fn().mockReturnValue({ uploadPayload }),
      makeFeedReader: jest.fn().mockReturnValue({ downloadPayload }),
    } as never,
    uploadData,
    uploadPayload,
  };
}

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
});
