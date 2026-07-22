import { keccak256, toUtf8Bytes, getBytes, concat } from 'ethers';
import { CATALOG_FEED_TOPIC, stateFeedTopic, readCatalogFeedRoot } from '../src/feeds.js';

const OWNER_A = '0x1111111111111111111111111111111111111111';
const OWNER_B = '0x2222222222222222222222222222222222222222';
const ITEM_1 = 'a'.repeat(64);
const ITEM_2 = 'b'.repeat(64);

describe('CATALOG_FEED_TOPIC', () => {
  it('is the fixed protocol constant keccak256("swarm-ai-catalog.v1")', () => {
    expect(CATALOG_FEED_TOPIC).toBe(keccak256(toUtf8Bytes('swarm-ai-catalog.v1')));
  });

  it('is a 0x-prefixed 32-byte hex string', () => {
    expect(CATALOG_FEED_TOPIC).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('stateFeedTopic', () => {
  it('matches the spec derivation keccak256(prefix || owner || itemId)', () => {
    const expected = keccak256(
      concat([toUtf8Bytes('swarm-ai-catalog-state.v1'), getBytes(OWNER_A), toUtf8Bytes(ITEM_1)]),
    );
    expect(stateFeedTopic(OWNER_A, ITEM_1)).toBe(expected);
  });

  it('is deterministic for the same owner + itemId', () => {
    expect(stateFeedTopic(OWNER_A, ITEM_1)).toBe(stateFeedTopic(OWNER_A, ITEM_1));
  });

  it('binds the topic to the owner (different owner ⇒ different topic)', () => {
    expect(stateFeedTopic(OWNER_A, ITEM_1)).not.toBe(stateFeedTopic(OWNER_B, ITEM_1));
  });

  it('binds the topic to the itemId (different item ⇒ different topic)', () => {
    expect(stateFeedTopic(OWNER_A, ITEM_1)).not.toBe(stateFeedTopic(OWNER_A, ITEM_2));
  });

  it('throws on a non-hex owner address (getBytes rejects it)', () => {
    expect(() => stateFeedTopic('not-an-address', ITEM_1)).toThrow();
  });
});

describe('readCatalogFeedRoot', () => {
  it('returns the bare hex payload from the latest feed update', async () => {
    const root = 'c'.repeat(64);
    const downloadPayload = jest.fn().mockResolvedValue({ payload: { toUtf8: () => root } });
    const makeFeedReader = jest.fn().mockReturnValue({ downloadPayload });
    const bee = { makeFeedReader } as never;

    await expect(readCatalogFeedRoot(bee, OWNER_A)).resolves.toBe(root);
    expect(makeFeedReader).toHaveBeenCalledWith(CATALOG_FEED_TOPIC, OWNER_A);
  });

  it('propagates the error when the feed has never been published', async () => {
    const downloadPayload = jest.fn().mockRejectedValue(new Error('feed not found'));
    const bee = { makeFeedReader: () => ({ downloadPayload }) } as never;

    await expect(readCatalogFeedRoot(bee, OWNER_A)).rejects.toThrow('feed not found');
  });
});
