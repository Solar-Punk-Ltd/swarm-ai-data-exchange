import { PurchaseError } from '../src/errors.js';

// Mock the internal pipeline so the handler test exercises orchestration only.
jest.mock('../src/catalog.js', () => ({ lookupItem: jest.fn() }));
jest.mock('../src/intent.js', () => ({
  decodeXPayment: jest.fn(),
  verifyPurchaseIntent: jest.fn(),
}));
jest.mock('../src/act.js', () => ({ grantActAccess: jest.fn() }));
jest.mock('@solarpunk/swarm-catalog', () => ({
  writeItemState: jest.fn().mockResolvedValue('stateref'),
}));

import { lookupItem } from '../src/catalog.js';
import { decodeXPayment, verifyPurchaseIntent } from '../src/intent.js';
import { grantActAccess } from '../src/act.js';
import { writeItemState } from '@solarpunk/swarm-catalog';
import { purchaseHandler } from '../src/purchase.js';

const lookupItemMock = lookupItem as jest.Mock;
const decodeXPaymentMock = decodeXPayment as jest.Mock;
const verifyMock = verifyPurchaseIntent as jest.Mock;
const grantMock = grantActAccess as jest.Mock;
const writeStateMock = writeItemState as jest.Mock;

const ITEM = 'a'.repeat(64);
const CONFIG = {
  catalogFeedOwner: '0xowner',
  chainId: 84532,
  purchaseIntentDomainContract: '0xcontract',
  facilitatorUrl: 'https://fac.example',
  facilitatorUrls: {},
  splitterAddresses: {},
  postageBatchId: 'f'.repeat(64),
  itemStateFeedPk: '0xpk',
};

const LOOKUP = {
  itemId: ITEM,
  description: 'An item',
  payments: [
    {
      scheme: 'exact',
      chainId: 'eip155:84532',
      asset: 'eip155:84532/erc20:0xUSDC',
      amount: '5000000',
      payTo: '0xPayTo',
    },
  ],
  state: {
    itemId: ITEM,
    actHistoryRef: 'old-hist',
    granteeRef: 'old-grantee',
    lifecycle: 'active',
    dateModified: 'x',
  },
};

function fakeReqRes(header?: string) {
  const req = {
    params: { itemId: ITEM },
    header: (_: string) => header,
    protocol: 'https',
    get: (_: string) => 'pub.example',
    originalUrl: `/v1/items/${ITEM}/purchase`,
  };
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

function makeStore() {
  return {
    isNonceUsed: jest.fn().mockReturnValue(false),
    recordNonce: jest.fn(),
    recordPurchase: jest.fn(),
  };
}

// The handler reads this node's ACT publisher key once for the ActGrantResult.
const BEE = { getNodeAddresses: async () => ({ publicKey: { toHex: () => '0x04grantor' } }) };

// `facilitatorFor` hands back the same mock for every URL; tests that care about routing wrap it.
function deps(facilitator: unknown, store: unknown, configOverride?: Record<string, unknown>) {
  return {
    bee: BEE,
    store,
    facilitatorFor: () => facilitator,
    config: { ...CONFIG, ...configOverride },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  writeStateMock.mockResolvedValue('stateref');
});

describe('purchaseHandler — catalog prerequisite', () => {
  it('returns the ApiError when the item is not found, before any payment branch', async () => {
    lookupItemMock.mockRejectedValue(new PurchaseError('item_not_found', 'gone'));
    const { req, res } = fakeReqRes(undefined);
    const handler = purchaseHandler(deps({}, makeStore()));

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'item_not_found', retryable: false });
    expect(decodeXPaymentMock).not.toHaveBeenCalled();
  });
});

describe('purchaseHandler — phase 1 (no X-Payment)', () => {
  it('returns a 402 challenge with the EIP-712 domain in extra', async () => {
    lookupItemMock.mockResolvedValue(LOOKUP);
    const { req, res } = fakeReqRes(undefined);
    const handler = purchaseHandler(deps({}, makeStore()));

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(402);
    const body = res.body as { x402Version: number; accepts: Array<Record<string, unknown>> };
    expect(body.x402Version).toBe(1);
    const accept = body.accepts[0] as { extra: { purchaseIntentDomain: Record<string, unknown> } };
    expect(accept.extra.purchaseIntentDomain).toEqual({
      name: 'Swarm AI Data Exchange',
      version: '1',
      chainId: 84532,
      verifyingContract: '0xcontract',
    });
  });

  it('advertises every rail with its own facilitator and EIP-712 chainId', async () => {
    lookupItemMock.mockResolvedValue({
      ...LOOKUP,
      payments: [
        ...LOOKUP.payments,
        {
          scheme: 'exact',
          chainId: 'eip155:11142220',
          asset: 'eip155:11142220/erc20:0xCeloUSDC',
          amount: '5000000',
          payTo: '0xCeloPayTo',
          facilitator: 'https://api.x402.sepolia.celo.org',
        },
        {
          scheme: 'exact',
          chainId: 'eip155:8453',
          asset: 'eip155:8453/erc20:0xUSDC',
          amount: '5000000',
          payTo: '0xBasePayTo',
        },
      ],
    });
    const { req, res } = fakeReqRes(undefined);
    const handler = purchaseHandler(
      deps({}, makeStore(), {
        facilitatorUrls: { 'eip155:8453': 'https://base-override.example' },
      }),
    );

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(402);
    const body = res.body as {
      accepts: Array<{
        network: string;
        payTo: string;
        extra: { facilitator: string; purchaseIntentDomain: { chainId: number } };
      }>;
    };
    expect(
      body.accepts.map((a) => [
        a.network,
        a.payTo,
        a.extra.facilitator,
        a.extra.purchaseIntentDomain.chainId,
      ]),
    ).toEqual([
      // No item facilitator, no override → the default.
      ['eip155:84532', '0xPayTo', 'https://fac.example', 84532],
      // The item's own facilitator wins.
      ['eip155:11142220', '0xCeloPayTo', 'https://api.x402.sepolia.celo.org', 11142220],
      // The per-rail override applies when the item names none.
      ['eip155:8453', '0xBasePayTo', 'https://base-override.example', 8453],
    ]);
  });
});

describe('purchaseHandler — phase 2 (with X-Payment)', () => {
  const envelope = {
    payload: { purchaseIntent: { message: { nonce: '0xnonce', granteePublicKey: '0x04beef' } } },
  };

  function wireVerifiedFlow() {
    lookupItemMock.mockResolvedValue(LOOKUP);
    decodeXPaymentMock.mockReturnValue(envelope);
    verifyMock.mockResolvedValue({
      consumerAddress: '0xconsumer',
      matched: {
        network: 'eip155:84532',
        asset: 'eip155:84532/erc20:0xUSDC',
        amount: '5000000',
        payTo: '0xPayTo',
      },
    });
    grantMock.mockResolvedValue({ actHistoryRef: 'new-hist', granteeRef: 'new-grantee' });
  }

  it('runs the full flow and returns an ActGrantResult on success', async () => {
    wireVerifiedFlow();
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: true }),
      settle: jest.fn().mockResolvedValue({ success: true, transaction: '0xtx' }),
    };
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler(deps(facilitator, store));

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      itemId: ITEM,
      actHistoryRef: 'new-hist',
      grantTo: '0x04beef',
      reference: ITEM,
      txHash: '0xtx',
    });
    // Nonce + purchase record written after settle, before grant.
    expect(store.recordNonce).toHaveBeenCalledWith('0xnonce');
    expect(store.recordPurchase).toHaveBeenCalledWith(
      '0xconsumer',
      ITEM,
      '0xtx',
      expect.any(String),
      '0xPayTo',
    );
    const recordOrder = store.recordPurchase.mock.invocationCallOrder[0];
    const grantOrder = grantMock.mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(grantOrder);
    // State feed advanced with the new refs.
    expect(writeStateMock).toHaveBeenCalledWith(
      expect.anything(),
      '0xpk',
      '0xowner',
      expect.objectContaining({ actHistoryRef: 'new-hist', granteeRef: 'new-grantee' }),
      'f'.repeat(64),
    );
  });

  it('routes a Celo-rail purchase to the facilitator the matched rail named', async () => {
    wireVerifiedFlow();
    verifyMock.mockResolvedValue({
      consumerAddress: '0xconsumer',
      matched: {
        network: 'eip155:11142220',
        asset: 'eip155:11142220/erc20:0xUSDC',
        amount: '5000000',
        payTo: '0xCeloPayTo',
        facilitator: 'https://api.x402.sepolia.celo.org',
      },
    });
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: true }),
      settle: jest.fn().mockResolvedValue({ success: true, transaction: '0xcelotx' }),
    };
    const facilitatorFor = jest.fn().mockReturnValue(facilitator);
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler({
      bee: BEE,
      store,
      facilitatorFor,
      config: CONFIG,
    } as never);

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(facilitatorFor).toHaveBeenCalledWith('https://api.x402.sepolia.celo.org');
    expect(store.recordPurchase).toHaveBeenCalledWith(
      '0xconsumer',
      ITEM,
      '0xcelotx',
      expect.any(String),
      '0xCeloPayTo',
    );
  });

  it('falls back to the per-rail facilitator override, then the default', async () => {
    wireVerifiedFlow();
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: true }),
      settle: jest.fn().mockResolvedValue({ success: true, transaction: '0xtx' }),
    };
    const facilitatorFor = jest.fn().mockReturnValue(facilitator);
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler({
      bee: BEE,
      store,
      facilitatorFor,
      config: { ...CONFIG, facilitatorUrls: { 'eip155:84532': 'https://override.example' } },
    } as never);

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(facilitatorFor).toHaveBeenCalledWith('https://override.example');
  });

  it('returns payment_verify_failed and never settles when /verify rejects', async () => {
    wireVerifiedFlow();
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: false, invalidReason: 'bad sig' }),
      settle: jest.fn(),
    };
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler(deps(facilitator, store));

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ error: 'payment_verify_failed' });
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(store.recordNonce).not.toHaveBeenCalled();
  });

  it('still returns 200 when the post-grant state-feed write fails, and retries it (§14.1)', async () => {
    wireVerifiedFlow();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    writeStateMock.mockRejectedValue(new Error('feed down'));
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: true }),
      settle: jest.fn().mockResolvedValue({ success: true, transaction: '0xtx' }),
    };
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler(
      deps(facilitator, store, {
        stateFeedRetry: { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ itemId: ITEM, txHash: '0xtx' });
    // Exhausts the bounded retry budget before giving up (grant already issued).
    expect(writeStateMock).toHaveBeenCalledTimes(3);
  });

  it('retries the state-feed write until it succeeds (§14.1)', async () => {
    wireVerifiedFlow();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    writeStateMock.mockRejectedValueOnce(new Error('feed down')).mockResolvedValueOnce('stateref');
    const store = makeStore();
    const facilitator = {
      verify: jest.fn().mockResolvedValue({ isValid: true }),
      settle: jest.fn().mockResolvedValue({ success: true, transaction: '0xtx' }),
    };
    const { req, res } = fakeReqRes('base64header');
    const handler = purchaseHandler(
      deps(facilitator, store, {
        stateFeedRetry: { attempts: 5, baseDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(writeStateMock).toHaveBeenCalledTimes(2);
  });
});
