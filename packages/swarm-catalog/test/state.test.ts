import { readItemState, writeItemState, NoStateFeedError } from '../src/state';
import { stateFeedTopic } from '../src/feeds';
import type { CatalogItemState } from '../src/types';

const OWNER = '0x1111111111111111111111111111111111111111';
const SIGNER = '0x'.padEnd(66, 'a');
const ITEM = 'a'.repeat(64);
const STATE_REF = 'd'.repeat(64);
const BATCH = 'f'.repeat(64);

const STATE: CatalogItemState = {
  itemId: ITEM,
  actHistoryRef: 'e'.repeat(64),
  granteeRef: 'c'.repeat(64),
  lifecycle: 'active',
  version: '1.0.0',
  catalogRootAtUpdate: 'b'.repeat(64),
  dateModified: '2026-06-02T00:00:00.000Z',
};

describe('writeItemState', () => {
  it('uploads the state JSON, pushes the feed update, and returns the blob reference', async () => {
    const uploadData = jest.fn().mockResolvedValue({ reference: { toString: () => STATE_REF } });
    const uploadPayload = jest.fn().mockResolvedValue({ reference: { toString: () => 'feedtx' } });
    const makeFeedWriter = jest.fn().mockReturnValue({ uploadPayload });
    const bee = { uploadData, makeFeedWriter } as never;

    const ref = await writeItemState(bee, SIGNER, OWNER, STATE, BATCH);

    expect(ref).toBe(STATE_REF);
    expect(uploadData).toHaveBeenCalledWith(BATCH, JSON.stringify(STATE));
    // Feed writer must be bound to the per-item state feed topic.
    expect(makeFeedWriter).toHaveBeenCalledWith(stateFeedTopic(OWNER, ITEM), SIGNER);
    // Feed payload points at the freshly uploaded blob.
    expect(uploadPayload).toHaveBeenCalledWith(BATCH, STATE_REF);
  });
});

describe('readItemState', () => {
  it('resolves the feed to a reference, downloads the blob, and parses it', async () => {
    const downloadPayload = jest.fn().mockResolvedValue({ payload: { toUtf8: () => STATE_REF } });
    const makeFeedReader = jest.fn().mockReturnValue({ downloadPayload });
    const downloadData = jest.fn().mockResolvedValue({ toUtf8: () => JSON.stringify(STATE) });
    const bee = { makeFeedReader, downloadData } as never;

    const result = await readItemState(bee, OWNER, ITEM);

    expect(result).toEqual(STATE);
    expect(makeFeedReader).toHaveBeenCalledWith(stateFeedTopic(OWNER, ITEM), OWNER);
    expect(downloadData).toHaveBeenCalledWith(STATE_REF);
  });

  it('throws NoStateFeedError when the feed has never been initialized', async () => {
    const downloadPayload = jest.fn().mockRejectedValue(new Error('not found'));
    const bee = { makeFeedReader: () => ({ downloadPayload }), downloadData: jest.fn() } as never;

    await expect(readItemState(bee, OWNER, ITEM)).rejects.toBeInstanceOf(NoStateFeedError);
  });
});
