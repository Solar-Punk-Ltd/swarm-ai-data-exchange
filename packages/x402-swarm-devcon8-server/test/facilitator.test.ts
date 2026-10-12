import { encodeAbiParameters } from 'viem';
import {
  FacilitatorClient,
  assetAddressFromCaip19,
  chainForCaip2,
  x402NetworkName,
  type MatchedPayment,
} from '../src/facilitator.js';
import type { PurchasePayload } from '@solarpunk/swarm-catalog';

const MATCHED: MatchedPayment = {
  network: 'eip155:84532',
  asset: 'eip155:84532/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '5000000',
  payTo: '0xPayTo',
};

const CELO_MATCHED: MatchedPayment = {
  network: 'eip155:11142220',
  asset: 'eip155:11142220/erc20:0x01C5C0122039549AD1493B8220cABEdD739BC44E',
  amount: '5000000',
  payTo: '0xCeloPayTo',
  facilitator: 'https://api.x402.sepolia.celo.org',
};

const FORNO = 'https://forno.celo-sepolia.celo-testnet.org';

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

// `name()` selector is 0x06fdde03, `version()` is 0x54fd4d50. Anything that is not a facilitator
// call is the token EIP-712 domain read, which viem issues as JSON-RPC eth_call over fetch.
function rpcResponse(body: string) {
  const request = JSON.parse(body) as
    | { id: number; params: [{ data: string }] }[]
    | {
        id: number;
        params: [{ data: string }];
      };
  const answer = (r: { id: number; params: [{ data: string }] }) => ({
    jsonrpc: '2.0',
    id: r.id,
    result: encodeAbiParameters(
      [{ type: 'string' }],
      [r.params[0].data === '0x06fdde03' ? 'USD Coin' : '2'],
    ),
  });
  const payload = Array.isArray(request) ? request.map(answer) : answer(request);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
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

describe('x402NetworkName', () => {
  it('maps the Base and Celo CAIP-2 networks to the facilitator v1 names', () => {
    expect(x402NetworkName('eip155:84532')).toBe('base-sepolia');
    expect(x402NetworkName('eip155:8453')).toBe('base');
    expect(x402NetworkName('eip155:11142220')).toBe('celo-sepolia');
    expect(x402NetworkName('eip155:42220')).toBe('celo');
  });
  it('throws for a network with no mapping', () => {
    expect(() => x402NetworkName('eip155:1')).toThrow(/No x402 network name/);
  });
});

describe('chainForCaip2', () => {
  it('resolves the viem chain for each supported rail', () => {
    expect(chainForCaip2('eip155:84532').id).toBe(84532);
    expect(chainForCaip2('eip155:11142220').id).toBe(11142220);
  });
  it('throws instead of falling back to Base for an unknown chain', () => {
    expect(() => chainForCaip2('eip155:1')).toThrow(/No viem chain/);
  });
});

describe('FacilitatorClient', () => {
  const RESOURCE = 'https://pub.example/v1/items/abc/purchase';
  let fetchMock: jest.Mock;
  let facilitatorResponse: unknown;

  function facilitatorCalls(): [string, RequestInit][] {
    return (fetchMock.mock.calls as [string, RequestInit][]).filter(
      ([url]) => !url.startsWith(FORNO) && !url.includes('base'),
    );
  }

  beforeEach(() => {
    fetchMock = jest.fn((url: string, init: RequestInit) =>
      url.startsWith('https://fac.example') || url.startsWith('https://api.x402')
        ? Promise.resolve(facilitatorResponse)
        : Promise.resolve(rpcResponse(init.body as string)),
    );
    global.fetch = fetchMock as never;
  });

  it('verify posts the x402 payload + requirements and returns the parsed result', async () => {
    facilitatorResponse = { ok: true, json: async () => ({ isValid: true, payer: '0xFrom' }) };
    const client = new FacilitatorClient('https://fac.example');

    const result = await client.verify(envelope(), MATCHED, RESOURCE);

    expect(result).toEqual({ isValid: true, payer: '0xFrom' });
    const [url, init] = facilitatorCalls()[0];
    expect(url).toBe('https://fac.example/verify');
    const body = JSON.parse(init.body as string);
    expect(body.x402Version).toBe(1);
    expect(body.paymentPayload.network).toBe('base-sepolia');
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
    // The token's EIP-712 domain, read from chain, travels in `extra`.
    expect(body.paymentRequirements.extra).toEqual({ name: 'USD Coin', version: '2' });
    // No API key configured → no auth header.
    expect((init.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
  });

  it('settle hits /settle and returns the parsed result', async () => {
    facilitatorResponse = { ok: true, json: async () => ({ success: true, transaction: '0xtx' }) };
    const client = new FacilitatorClient('https://fac.example');

    const result = await client.settle(envelope(), MATCHED, RESOURCE);

    expect(result).toEqual({ success: true, transaction: '0xtx' });
    expect(facilitatorCalls()[0][0]).toBe('https://fac.example/settle');
  });

  it('throws when the facilitator returns a non-2xx status', async () => {
    facilitatorResponse = { ok: false, status: 500, text: async () => 'upstream down' };
    const client = new FacilitatorClient('https://fac.example');
    await expect(client.verify(envelope(), MATCHED, RESOURCE)).rejects.toThrow(/returned 500/);
  });

  it('sends X-API-Key on /verify and /settle when configured', async () => {
    facilitatorResponse = { ok: true, json: async () => ({ success: true, transaction: '0xtx' }) };
    const client = new FacilitatorClient('https://api.x402.sepolia.celo.org', {
      apiKey: 'secret',
      rpcUrls: { 'eip155:11142220': FORNO },
    });

    await client.verify(envelope(), CELO_MATCHED, RESOURCE);
    await client.settle(envelope(), CELO_MATCHED, RESOURCE);

    const calls = facilitatorCalls();
    expect(calls.map(([url]) => url)).toEqual([
      'https://api.x402.sepolia.celo.org/verify',
      'https://api.x402.sepolia.celo.org/settle',
    ]);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret');
      const body = JSON.parse(init.body as string);
      expect(body.paymentPayload.network).toBe('celo-sepolia');
      expect(body.paymentRequirements.network).toBe('celo-sepolia');
    }
  });

  it('reads the token domain over the configured RPC for the matched rail', async () => {
    facilitatorResponse = { ok: true, json: async () => ({ isValid: true }) };
    const client = new FacilitatorClient('https://api.x402.sepolia.celo.org', {
      rpcUrls: { 'eip155:11142220': FORNO },
    });

    // A fresh token address so the module-level domain cache cannot satisfy the read.
    await client.verify(
      envelope(),
      {
        ...CELO_MATCHED,
        asset: 'eip155:11142220/erc20:0x0000000000000000000000000000000000000ce1',
      },
      RESOURCE,
    );

    // viem normalises the endpoint through `new URL`, which adds a trailing slash.
    const rpcCalls = (fetchMock.mock.calls as [string][]).filter(([url]) =>
      String(url).startsWith(FORNO),
    );
    expect(rpcCalls.length).toBeGreaterThan(0);
  });
});
