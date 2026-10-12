import { PurchaseError } from '../src/errors.js';

// Mock the internal pipeline so the handler test exercises orchestration only: rail routing,
// the voucher, and the ordering of the committing steps.
jest.mock('../src/intent.js', () => ({
  decodeXPayment: jest.fn(),
  verifyPurchaseIntent: jest.fn(),
}));
jest.mock('../src/act.js', () => ({ grantActAccess: jest.fn() }));
jest.mock('@solarpunk/swarm-catalog', () => ({
  writeItemState: jest.fn().mockResolvedValue('stateref'),
}));

import { decodeXPayment, verifyPurchaseIntent } from '../src/intent.js';
import { grantActAccess } from '../src/act.js';
import { purchaseHandler } from '../src/purchase.js';

const decodeXPaymentMock = decodeXPayment as jest.Mock;
const verifyMock = verifyPurchaseIntent as jest.Mock;
const grantMock = grantActAccess as jest.Mock;

const ITEM = 'a'.repeat(64);
const CELO_FACILITATOR = 'https://api.x402.sepolia.celo.org';

const CONFIG = {
  catalogFeedOwner: '0xowner',
  chainId: 84532,
  purchaseIntentDomainContract: '0xcontract',
  facilitatorUrl: 'https://fac.example',
  facilitatorUrls: {},
  splitterAddresses: {},
  postageBatchId: 'f'.repeat(64),
  itemStateFeedPk: '0xpk',
  stateFeedRetry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
};

const LOOKUP = {
  itemId: ITEM,
  description: 'Voucher',
  payments: [
    {
      scheme: 'exact',
      chainId: 'eip155:84532',
      asset: 'eip155:84532/erc20:0xBaseUSDC',
      amount: '10000',
      payTo: '0xBaseClone',
    },
    {
      scheme: 'exact',
      chainId: 'eip155:11142220',
      asset: 'eip155:11142220/erc20:0xCeloUSDC',
      amount: '10000',
      payTo: '0xCeloClone',
      facilitator: CELO_FACILITATOR,
    },
  ],
  state: { itemId: ITEM, actHistoryRef: 'old-hist', granteeRef: 'old-grantee' },
};

const BEE = { getNodeAddresses: async () => ({ publicKey: { toHex: () => '0x04grantor' } }) };

function fakeReqRes(header?: string) {
  const req = {
    params: { itemId: ITEM },
    header: () => header,
    protocol: 'https',
    get: () => 'pub.example',
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
    getVoucher: jest.fn().mockReturnValue(undefined),
    recordVoucher: jest.fn(),
    markVoucherFunded: jest.fn(),
  };
}

function makeCatalog() {
  return { lookup: jest.fn().mockResolvedValue(LOOKUP), noteGrant: jest.fn() };
}

function makeFunder() {
  return { fund: jest.fn().mockResolvedValue({ xdaiTx: '0xxdai', xbzzTx: '0xxbzz' }) };
}

function makeFacilitator(tx: string) {
  return {
    verify: jest.fn().mockResolvedValue({ isValid: true }),
    settle: jest.fn().mockResolvedValue({ success: true, transaction: tx }),
  };
}

function handlerWith(overrides: Record<string, unknown>) {
  return purchaseHandler({
    bee: BEE,
    store: makeStore(),
    facilitatorFor: jest.fn(),
    config: CONFIG,
    funder: makeFunder(),
    catalog: makeCatalog(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  decodeXPaymentMock.mockReturnValue({
    payload: { purchaseIntent: { message: { nonce: '0xnonce', granteePublicKey: '0x04beef' } } },
  });
  grantMock.mockResolvedValue({ actHistoryRef: 'new-hist', granteeRef: 'new-grantee' });
});

describe('devcon8 purchaseHandler — phase 1', () => {
  it('advertises both rails, each with its own facilitator', async () => {
    const { req, res } = fakeReqRes(undefined);

    await handlerWith({})(req as never, res as never);

    expect(res.statusCode).toBe(402);
    const body = res.body as {
      accepts: Array<{ network: string; extra: { facilitator: string } }>;
    };
    expect(body.accepts.map((a) => [a.network, a.extra.facilitator])).toEqual([
      ['eip155:84532', 'https://fac.example'],
      ['eip155:11142220', CELO_FACILITATOR],
    ]);
  });
});

describe('devcon8 purchaseHandler — phase 2', () => {
  it('settles a Celo-rail purchase through the Celo facilitator and still issues a voucher', async () => {
    verifyMock.mockResolvedValue({
      consumerAddress: '0xconsumer',
      matched: {
        network: 'eip155:11142220',
        asset: 'eip155:11142220/erc20:0xCeloUSDC',
        amount: '10000',
        payTo: '0xCeloClone',
        facilitator: CELO_FACILITATOR,
      },
    });
    const store = makeStore();
    const funder = makeFunder();
    const catalog = makeCatalog();
    const facilitator = makeFacilitator('0xcelotx');
    const facilitatorFor = jest.fn().mockReturnValue(facilitator);
    const { req, res } = fakeReqRes('base64header');

    await handlerWith({
      store,
      funder,
      catalog,
      facilitatorFor,
      config: { ...CONFIG, splitterAddresses: { 'eip155:11142220': '0xCeloClone' } },
    })(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(facilitatorFor).toHaveBeenCalledWith(CELO_FACILITATOR);
    expect(facilitator.settle).toHaveBeenCalled();
    expect(verifyMock.mock.calls[0][1].expectedPayToByChain).toEqual({
      'eip155:11142220': '0xCeloClone',
    });
    expect(store.recordPurchase).toHaveBeenCalledWith(
      '0xconsumer',
      ITEM,
      '0xcelotx',
      expect.any(String),
      '0xCeloClone',
    );
    // The voucher is keyed on the Celo settlement and funded on the gift chain regardless.
    expect(store.recordVoucher).toHaveBeenCalledWith('0xcelotx', expect.any(String));
    expect(funder.fund).toHaveBeenCalledTimes(1);
    expect(catalog.noteGrant).toHaveBeenCalled();
    const data = JSON.parse((res.body as { data: string }).data);
    expect(data).toMatchObject({ type: 'devcon8-voucher', funded: true });
    expect(data.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('falls back to the default facilitator for a rail that names none', async () => {
    verifyMock.mockResolvedValue({
      consumerAddress: '0xconsumer',
      matched: {
        network: 'eip155:84532',
        asset: 'eip155:84532/erc20:0xBaseUSDC',
        amount: '10000',
        payTo: '0xBaseClone',
      },
    });
    const facilitatorFor = jest.fn().mockReturnValue(makeFacilitator('0xbasetx'));
    const { req, res } = fakeReqRes('base64header');

    await handlerWith({ facilitatorFor })(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(facilitatorFor).toHaveBeenCalledWith('https://fac.example');
  });

  it('never settles or mints a voucher when the intent is rejected', async () => {
    verifyMock.mockRejectedValue(
      new PurchaseError('payment_destination_untaxed', 'No split contract is configured'),
    );
    const store = makeStore();
    const funder = makeFunder();
    const facilitatorFor = jest.fn();
    const { req, res } = fakeReqRes('base64header');

    await handlerWith({ store, funder, facilitatorFor })(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(facilitatorFor).not.toHaveBeenCalled();
    expect(store.recordVoucher).not.toHaveBeenCalled();
    expect(funder.fund).not.toHaveBeenCalled();
  });
});
