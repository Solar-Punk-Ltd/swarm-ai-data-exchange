import { privateKeyToAccount } from 'viem/accounts';
import {
  PURCHASE_INTENT_TYPES,
  type PaymentRequirements,
  type PurchasePayload,
} from '@solarpunk/swarm-catalog';
import { decodeXPayment, verifyPurchaseIntent } from '../src/intent.js';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PK);

const CONTRACT = '0x0000000000000000000000000000000000000001';
const PAYTO = '0x000000000000000000000000000000000000dEaD';
const ASSET = 'eip155:84532/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ITEM = 'a'.repeat(64);
const NONCE = '0x' + '3f'.repeat(32);
const GRANTEE = '0x04' + 'ab'.repeat(32);
const CHAIN_ID = 84532;

const PAYMENT = { scheme: 'exact' as const, asset: ASSET, amount: '5000000', payTo: PAYTO };
const ITEM_PAYMENTS: PaymentRequirements[] = [
  { scheme: 'exact', chainId: 'eip155:84532', asset: ASSET, amount: '5000000', payTo: PAYTO },
];

const domain = {
  name: 'Swarm AI Data Exchange',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: CONTRACT as `0x${string}`,
};

async function signedEnvelope(): Promise<PurchasePayload> {
  const validAfter = 1000;
  const validBefore = 9_999_999_999;
  const signature = await account.signTypedData({
    domain,
    types: {
      PurchaseIntent: PURCHASE_INTENT_TYPES.PurchaseIntent,
      Payment: PURCHASE_INTENT_TYPES.Payment,
    },
    primaryType: 'PurchaseIntent',
    message: {
      itemId: ITEM,
      granteePublicKey: GRANTEE as `0x${string}`,
      payment: { scheme: 'exact', asset: ASSET, amount: 5000000n, payTo: PAYTO as `0x${string}` },
      nonce: NONCE as `0x${string}`,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
    },
  });
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:84532',
    payload: {
      purchaseIntent: {
        domain,
        types: PURCHASE_INTENT_TYPES,
        primaryType: 'PurchaseIntent',
        message: {
          itemId: ITEM,
          granteePublicKey: GRANTEE,
          payment: PAYMENT,
          nonce: NONCE,
          validAfter,
          validBefore,
        },
        signature,
      },
      authorization: {
        from: account.address,
        to: PAYTO,
        value: '5000000',
        validAfter,
        validBefore,
        nonce: NONCE,
        signature: '0xpaymentauthsig',
      },
    },
  };
}

const baseOpts = {
  pathItemId: ITEM,
  domainContract: CONTRACT,
  itemPayments: ITEM_PAYMENTS,
  isNonceUsed: () => false,
  now: 1_000_000,
};

describe('decodeXPayment', () => {
  it('round-trips a base64-encoded envelope', async () => {
    const env = await signedEnvelope();
    const header = Buffer.from(JSON.stringify(env)).toString('base64');
    expect(decodeXPayment(header).payload.purchaseIntent.message.itemId).toBe(ITEM);
  });

  it('throws intent_malformed on non-JSON payload', () => {
    const header = Buffer.from('not json at all').toString('base64');
    expect(() => decodeXPayment(header)).toThrow(/intent_malformed|not valid JSON/);
  });

  it('throws intent_malformed when required envelope fields are missing', () => {
    const header = Buffer.from('{}').toString('base64');
    expect(() => decodeXPayment(header)).toThrow(/missing required fields/);
  });
});

describe('verifyPurchaseIntent — happy path', () => {
  it('recovers the payer EOA and returns the matched payment', async () => {
    const env = await signedEnvelope();
    const { consumerAddress, matched } = await verifyPurchaseIntent(env, baseOpts);
    expect(consumerAddress.toLowerCase()).toBe(account.address.toLowerCase());
    expect(matched).toEqual({
      network: 'eip155:84532',
      asset: ASSET,
      amount: '5000000',
      payTo: PAYTO,
    });
  });
});

describe('verifyPurchaseIntent — rejections (§11.5)', () => {
  it('intent_malformed when authorization is inconsistent with the intent', async () => {
    const env = await signedEnvelope();
    env.payload.authorization.value = '999';
    await expect(verifyPurchaseIntent(env, baseOpts)).rejects.toThrow(/inconsistent/);
  });

  it('intent_signature_invalid when the recovered signer is not the payer', async () => {
    const env = await signedEnvelope();
    env.payload.authorization.from = '0x0000000000000000000000000000000000000abc';
    await expect(verifyPurchaseIntent(env, baseOpts)).rejects.toThrow(/expected payer EOA/);
  });

  it('intent_domain_mismatch when the verifying contract differs', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, {
        ...baseOpts,
        domainContract: '0x0000000000000000000000000000000000000002',
      }),
    ).rejects.toThrow(/domain does not match/);
  });

  it('intent_item_mismatch when the path itemId differs', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, { ...baseOpts, pathItemId: 'b'.repeat(64) }),
    ).rejects.toThrow(/itemId does not match/);
  });

  it('intent_payment_mismatch when no accepts entry matches', async () => {
    const env = await signedEnvelope();
    const other: PaymentRequirements[] = [{ ...ITEM_PAYMENTS[0], amount: '9999' }];
    await expect(verifyPurchaseIntent(env, { ...baseOpts, itemPayments: other })).rejects.toThrow(
      /payment does not match/,
    );
  });

  it('intent_not_yet_valid before the window opens', async () => {
    const env = await signedEnvelope();
    await expect(verifyPurchaseIntent(env, { ...baseOpts, now: 0 })).rejects.toThrow(
      /not yet valid/,
    );
  });

  it('intent_expired after the window closes', async () => {
    const env = await signedEnvelope();
    await expect(verifyPurchaseIntent(env, { ...baseOpts, now: 10_000_000_000 })).rejects.toThrow(
      /expired/,
    );
  });

  it('intent_replay when the nonce has been used', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, { ...baseOpts, isNonceUsed: () => true }),
    ).rejects.toThrow(/already been used/);
  });
});

describe('verifyPurchaseIntent — settlement destination guard', () => {
  const GUARD = { 'eip155:84532': PAYTO };

  it('accepts a payment whose payTo is the split contract for its rail', async () => {
    const env = await signedEnvelope();
    const { matched } = await verifyPurchaseIntent(env, {
      ...baseOpts,
      expectedPayToByChain: GUARD,
    });
    expect(matched.payTo).toBe(PAYTO);
  });

  it('matches the split contract case-insensitively', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, {
        ...baseOpts,
        expectedPayToByChain: { 'eip155:84532': PAYTO.toLowerCase() },
      }),
    ).resolves.toBeDefined();
  });

  // A stale catalog entry still advertising the publisher's EOA would settle untaxed and earn no
  // Proof-of-Purchase — reject it before /settle, while the failure is still free.
  it('payment_destination_untaxed when payTo is not the split contract', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, {
        ...baseOpts,
        expectedPayToByChain: { 'eip155:84532': '0x0000000000000000000000000000000000000009' },
      }),
    ).rejects.toThrow(/split contract/);
  });

  // The guard is on, but only for another rail: the catalog advertises a chain the seller has
  // no clone on, so nothing there can collect the tax.
  it('payment_destination_untaxed when the matched rail has no split contract configured', async () => {
    const env = await signedEnvelope();
    await expect(
      verifyPurchaseIntent(env, {
        ...baseOpts,
        expectedPayToByChain: { 'eip155:11142220': PAYTO },
      }),
    ).rejects.toThrow(/No split contract is configured/);
  });

  it('accepts any payTo when no split contract is configured', async () => {
    const env = await signedEnvelope();
    await expect(verifyPurchaseIntent(env, baseOpts)).resolves.toBeDefined();
    await expect(
      verifyPurchaseIntent(env, { ...baseOpts, expectedPayToByChain: {} }),
    ).resolves.toBeDefined();
  });
});

describe('verifyPurchaseIntent — multi-rail items', () => {
  const CELO_ASSET = 'eip155:11142220/erc20:0x01C5C0122039549AD1493B8220cABEdD739BC44E';
  const CELO_PAYTO = '0x000000000000000000000000000000000000ce10';
  const CELO_FACILITATOR = 'https://api.x402.sepolia.celo.org';
  const TWO_RAILS: PaymentRequirements[] = [
    ...ITEM_PAYMENTS,
    {
      scheme: 'exact',
      chainId: 'eip155:11142220',
      asset: CELO_ASSET,
      amount: '5000000',
      payTo: CELO_PAYTO,
      facilitator: CELO_FACILITATOR,
    },
  ];

  async function celoEnvelope(): Promise<PurchasePayload> {
    const env = await signedEnvelope();
    const celoDomain = { ...domain, chainId: 11142220 };
    const message = {
      ...env.payload.purchaseIntent.message,
      payment: { ...PAYMENT, asset: CELO_ASSET, payTo: CELO_PAYTO },
    };
    const signature = await account.signTypedData({
      domain: celoDomain,
      types: {
        PurchaseIntent: PURCHASE_INTENT_TYPES.PurchaseIntent,
        Payment: PURCHASE_INTENT_TYPES.Payment,
      },
      primaryType: 'PurchaseIntent',
      message: {
        ...message,
        granteePublicKey: GRANTEE as `0x${string}`,
        payment: {
          scheme: 'exact',
          asset: CELO_ASSET,
          amount: 5000000n,
          payTo: CELO_PAYTO as `0x${string}`,
        },
        nonce: NONCE as `0x${string}`,
        validAfter: BigInt(message.validAfter),
        validBefore: BigInt(message.validBefore),
      },
    });
    return {
      ...env,
      network: 'eip155:11142220',
      payload: {
        purchaseIntent: { ...env.payload.purchaseIntent, domain: celoDomain, message, signature },
        authorization: { ...env.payload.authorization, to: CELO_PAYTO },
      },
    };
  }

  it('selects the rail whose chainId matches the signed domain and returns its facilitator', async () => {
    const env = await celoEnvelope();
    const { matched } = await verifyPurchaseIntent(env, {
      ...baseOpts,
      itemPayments: TWO_RAILS,
      expectedPayToByChain: { 'eip155:84532': PAYTO, 'eip155:11142220': CELO_PAYTO },
    });
    expect(matched).toEqual({
      network: 'eip155:11142220',
      asset: CELO_ASSET,
      amount: '5000000',
      payTo: CELO_PAYTO,
      facilitator: CELO_FACILITATOR,
    });
  });

  it('a Base-signed intent against the same item still matches the Base rail', async () => {
    const env = await signedEnvelope();
    const { matched } = await verifyPurchaseIntent(env, {
      ...baseOpts,
      itemPayments: TWO_RAILS,
      expectedPayToByChain: { 'eip155:84532': PAYTO, 'eip155:11142220': CELO_PAYTO },
    });
    expect(matched.network).toBe('eip155:84532');
    expect(matched.facilitator).toBeUndefined();
  });

  it('a Celo-signed intent is rejected when the Celo rail has no split contract', async () => {
    const env = await celoEnvelope();
    await expect(
      verifyPurchaseIntent(env, {
        ...baseOpts,
        itemPayments: TWO_RAILS,
        expectedPayToByChain: { 'eip155:84532': PAYTO },
      }),
    ).rejects.toThrow(/No split contract is configured/);
  });
});
