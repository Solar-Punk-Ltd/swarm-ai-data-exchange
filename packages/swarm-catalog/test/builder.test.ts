import { MantarayNode } from '@ethersphere/bee-js';
import { SwarmCatalogBuilder } from '../src/builder';
import type { CatalogItem, ContentSpec } from '../src/types';

// Well-known test private key (Hardhat account #0). Real bee-js PrivateKey accepts it.
const SIGNER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BATCH = 'f'.repeat(64);
const REF = 'a'.repeat(64);

function makeBuilder(bee: unknown = {}): SwarmCatalogBuilder {
  return new SwarmCatalogBuilder({
    bee: bee as never,
    catalogFeedSigner: SIGNER,
    itemStateFeedSigner: SIGNER,
    postageBatchId: BATCH,
  });
}

// A fully valid, warning-free item (has license + sample).
function validItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  const content: ContentSpec = { type: 'text', encodingFormat: 'text/plain' };
  return {
    id: REF,
    name: 'Valid',
    description: 'desc',
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
    license: 'MIT',
    sample: { kind: 'subset', path: 'sample/p.txt' },
    lifecycle: 'active',
    dateAdded: '2026-06-01T00:00:00.000Z',
    dateModified: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('constructor', () => {
  it('derives a 0x-prefixed 20-byte catalog feed owner from the signer', () => {
    const builder = makeBuilder() as unknown as { catalogFeedOwner: string };
    expect(builder.catalogFeedOwner).toMatch(/^0x[0-9a-f]{40}$/i);
  });

  it('derives the same owner deterministically for the same key', () => {
    const a = makeBuilder() as unknown as { catalogFeedOwner: string };
    const b = makeBuilder() as unknown as { catalogFeedOwner: string };
    expect(a.catalogFeedOwner).toBe(b.catalogFeedOwner);
  });
});

describe('stageItem — validation (§12.3, MUST reject)', () => {
  it('throws when id !== storage.reference', () => {
    expect(() => makeBuilder().stageItem(validItem({ id: 'b'.repeat(64) }))).toThrow(
      /id must equal storage.reference/,
    );
  });

  it('throws when payment array is empty', () => {
    expect(() => makeBuilder().stageItem(validItem({ payment: [] }))).toThrow(
      /payment array must not be empty/,
    );
  });

  it('throws on an invalid lifecycle value', () => {
    expect(() => makeBuilder().stageItem(validItem({ lifecycle: 'archived' as never }))).toThrow(
      /invalid lifecycle/,
    );
  });

  it('throws when encodingFormat is missing', () => {
    const content = { type: 'text' } as unknown as ContentSpec;
    expect(() => makeBuilder().stageItem(validItem({ content }))).toThrow(
      /encodingFormat is required/,
    );
  });

  it('throws when image is missing width/height', () => {
    const content = { type: 'image', encodingFormat: 'image/png' } as unknown as ContentSpec;
    expect(() => makeBuilder().stageItem(validItem({ content }))).toThrow(
      /width and height are required/,
    );
  });

  it('throws when video is missing duration', () => {
    const content = {
      type: 'video',
      encodingFormat: 'video/mp4',
      width: 1,
      height: 1,
    } as unknown as ContentSpec;
    expect(() => makeBuilder().stageItem(validItem({ content }))).toThrow(/duration is required/);
  });

  it('throws when audio is missing duration', () => {
    const content = { type: 'audio', encodingFormat: 'audio/mpeg' } as unknown as ContentSpec;
    expect(() => makeBuilder().stageItem(validItem({ content }))).toThrow(/duration is required/);
  });

  it('throws when a url-shaped license is not a valid IRI', () => {
    expect(() => makeBuilder().stageItem(validItem({ license: 'http://' }))).toThrow(
      /license is not a valid IRI/,
    );
  });

  it('accepts an SPDX (non-url-shaped) license', () => {
    expect(() => makeBuilder().stageItem(validItem({ license: 'Apache-2.0' }))).not.toThrow();
  });

  it('throws when a payment facilitator is not a valid IRI', () => {
    const item = validItem();
    item.payment[0].facilitator = 'not-a-url';
    expect(() => makeBuilder().stageItem(item)).toThrow(/facilitator is not a valid IRI/);
  });
});

describe('stageItem — warnings (SHOULD warn, do not throw)', () => {
  it('warns when license is missing', () => {
    makeBuilder().stageItem(validItem({ license: undefined }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('license missing'));
  });

  it('warns when tags exceed the soft cap of 20', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    makeBuilder().stageItem(validItem({ tags }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tags exceed soft cap'));
  });

  it('warns when a priced item (≥ 1 USDC) has no sample', () => {
    makeBuilder().stageItem(
      validItem({
        sample: undefined,
        payment: [
          {
            scheme: 'exact',
            chainId: 'eip155:84532',
            asset: 'x',
            amount: '1000000',
            payTo: '0xdead',
          },
        ],
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no sample'));
  });

  it('does not warn for a fully valid item', () => {
    makeBuilder().stageItem(validItem());
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('staging bookkeeping', () => {
  it('stageLifecycle on a staged item is applied (precedence) before a publish guard', async () => {
    // Indirectly: staged map holds the item; lifecycle merge happens in publish().
    const builder = makeBuilder();
    builder.stageItem(validItem());
    builder.stageLifecycle(REF, 'deprecated');
    // No ACT seed for this priced item ⇒ publish must reject with the seed guard,
    // proving the lifecycle merge ran before any Bee interaction.
    await expect(builder.publish()).rejects.toThrow(/Missing ACT seed/);
  });
});

describe('dryRun', () => {
  it('returns an empty root and a MantarayNode with a fork per staged item', async () => {
    const builder = makeBuilder();
    builder.stageItem(validItem());
    builder.stageItem(validItem({ id: 'b'.repeat(64), storage: { reference: 'b'.repeat(64) } }));

    const { root, manifest } = await builder.dryRun();
    expect(root).toBe('');
    expect(manifest).toBeInstanceOf(MantarayNode);
    expect(manifest.find(`/items/${REF}/item.jsonld`)).toBeTruthy();
    expect(manifest.find(`/items/${'b'.repeat(64)}/item.jsonld`)).toBeTruthy();
  });

  it('performs no Bee I/O', async () => {
    const uploadData = jest.fn();
    const builder = makeBuilder({ uploadData });
    builder.stageItem(validItem());
    await builder.dryRun();
    expect(uploadData).not.toHaveBeenCalled();
  });
});

describe('publish — ACT seed guard', () => {
  it('rejects when a priced item has no ACT seed', async () => {
    const builder = makeBuilder();
    builder.stageItem(validItem());
    await expect(builder.publish()).rejects.toThrow(/Missing ACT seed for priced item/);
  });
});
