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
  chainId: CHAIN_ID,
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
