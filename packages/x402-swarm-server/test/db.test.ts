import { Store } from '../src/db.js';

describe('Store', () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('reports a nonce as unused until it is recorded', () => {
    const nonce = '0x' + 'ab'.repeat(32);
    expect(store.isNonceUsed(nonce)).toBe(false);
    store.recordNonce(nonce);
    expect(store.isNonceUsed(nonce)).toBe(true);
  });

  it('treats recordNonce as idempotent (no throw on replay write)', () => {
    const nonce = '0x' + 'cd'.repeat(32);
    store.recordNonce(nonce);
    expect(() => store.recordNonce(nonce)).not.toThrow();
    expect(store.isNonceUsed(nonce)).toBe(true);
  });

  it('records a purchase without affecting unrelated nonces', () => {
    expect(() =>
      store.recordPurchase('0xconsumer', 'a'.repeat(64), '0xtx', new Date().toISOString()),
    ).not.toThrow();
    expect(store.isNonceUsed('0xnever')).toBe(false);
  });
});
