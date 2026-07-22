import { PURCHASE_INTENT_TYPES } from '../src/types';

describe('PURCHASE_INTENT_TYPES (EIP-712 descriptor)', () => {
  it('declares the PurchaseIntent fields in the spec order with correct ABI types', () => {
    expect(PURCHASE_INTENT_TYPES.PurchaseIntent).toEqual([
      { name: 'itemId', type: 'string' },
      { name: 'granteePublicKey', type: 'bytes' },
      { name: 'payment', type: 'Payment' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
    ]);
  });

  it('declares the nested Payment struct fields', () => {
    expect(PURCHASE_INTENT_TYPES.Payment).toEqual([
      { name: 'scheme', type: 'string' },
      { name: 'asset', type: 'string' },
      { name: 'amount', type: 'uint256' },
      { name: 'payTo', type: 'address' },
    ]);
  });
});
