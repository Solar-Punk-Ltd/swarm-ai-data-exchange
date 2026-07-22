import {
  FacilitatorClient,
  assetAddressFromCaip19,
  type MatchedPayment,
} from '../src/facilitator.js';
import type { PurchasePayload } from '@solarpunk/swarm-catalog';

const MATCHED: MatchedPayment = {
  network: 'eip155:84532',
  asset: 'eip155:84532/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '5000000',
  payTo: '0xPayTo',
};

function envelope(): PurchasePayload {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:84532',
    payload: {
      purchaseIntent: {} as never,
      authorization: {
        from: '0xFrom',
        to: '0xPayTo',
        value: '5000000',
        validAfter: 1000,
        validBefore: 2000,
        nonce: '0xnonce',
        signature: '0xsig',
      },
    },
  };
}

describe('assetAddressFromCaip19', () => {
  it('extracts the token address from a CAIP-19 asset id', () => {
    expect(assetAddressFromCaip19('eip155:84532/erc20:0xABC')).toBe('0xABC');
  });
  it('returns the input unchanged when there is no colon', () => {
    expect(assetAddressFromCaip19('0xABC')).toBe('0xABC');
  });
});

describe('FacilitatorClient', () => {
  const RESOURCE = 'https://pub.example/v1/items/abc/purchase';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  it('verify posts the x402 payload + requirements and returns the parsed result', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ isValid: true, payer: '0xFrom' }),
    });
    const client = new FacilitatorClient('https://fac.example');

    const result = await client.verify(envelope(), MATCHED, RESOURCE);

    expect(result).toEqual({ isValid: true, payer: '0xFrom' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fac.example/verify');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.x402Version).toBe(1);
    // ERC-3009 authorization is carried through with uint fields stringified.
    expect(body.paymentPayload.payload.authorization).toEqual({
      from: '0xFrom',
      to: '0xPayTo',
      value: '5000000',
      validAfter: '1000',
      validBefore: '2000',
      nonce: '0xnonce',
    });
    expect(body.paymentPayload.payload.signature).toBe('0xsig');
    // Requirements carry the bare token address, not the CAIP-19 string.
    expect(body.paymentRequirements.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(body.paymentRequirements.maxAmountRequired).toBe('5000000');
  });

  it('settle hits /settle and returns the parsed result', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, transaction: '0xtx' }),
    });
    const client = new FacilitatorClient('https://fac.example');

    const result = await client.settle(envelope(), MATCHED, RESOURCE);

    expect(result).toEqual({ success: true, transaction: '0xtx' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://fac.example/settle');
  });

  it('throws when the facilitator returns a non-2xx status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'upstream down' });
    const client = new FacilitatorClient('https://fac.example');
    await expect(client.verify(envelope(), MATCHED, RESOURCE)).rejects.toThrow(/returned 500/);
  });
});
