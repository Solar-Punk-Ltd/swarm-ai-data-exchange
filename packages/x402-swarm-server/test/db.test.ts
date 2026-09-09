import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

// pay_to is the settlement destination — the on-file evidence that a purchase went through the
// seller's split contract rather than an untaxed side channel. A later Proof-of-Purchase check
// reads it, so it must survive both fresh installs and DBs created before the column existed.
describe('Store — pay_to column', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'x402-store-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readPurchases(path: string): Array<Record<string, unknown>> {
    const db = new Database(path, { readonly: true });
    const rows = db.prepare('SELECT * FROM purchases').all() as Array<Record<string, unknown>>;
    db.close();
    return rows;
  }

  it('persists the settlement destination', () => {
    const store = new Store(dbPath);
    store.recordPurchase(
      '0xconsumer',
      'a'.repeat(64),
      '0xtx',
      '2026-08-12T00:00:00.000Z',
      '0xsplit',
    );
    store.close();

    expect(readPurchases(dbPath)).toEqual([
      {
        consumer_address: '0xconsumer',
        item_id: 'a'.repeat(64),
        tx_hash: '0xtx',
        settled_at: '2026-08-12T00:00:00.000Z',
        pay_to: '0xsplit',
      },
    ]);
  });

  it('stores NULL when no destination is supplied', () => {
    const store = new Store(dbPath);
    store.recordPurchase('0xconsumer', 'a'.repeat(64), '0xtx', '2026-08-12T00:00:00.000Z');
    store.close();

    expect(readPurchases(dbPath)[0].pay_to).toBeNull();
  });

  it('migrates a pre-existing purchases table without losing rows', () => {
    // A DB as an earlier build left it: no pay_to column.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE purchases (
        consumer_address TEXT NOT NULL,
        item_id          TEXT NOT NULL,
        tx_hash          TEXT NOT NULL,
        settled_at       TEXT NOT NULL
      );
      INSERT INTO purchases VALUES ('0xold', 'b', '0xoldtx', '2026-01-01T00:00:00.000Z');
    `);
    legacy.close();

    const store = new Store(dbPath);
    store.recordPurchase('0xnew', 'c', '0xnewtx', '2026-08-12T00:00:00.000Z', '0xsplit');
    store.close();

    const rows = readPurchases(dbPath);
    expect(rows).toHaveLength(2);
    expect(rows[0].pay_to).toBeNull();
    expect(rows[1].pay_to).toBe('0xsplit');
  });

  it('is idempotent across reopens', () => {
    new Store(dbPath).close();
    expect(() => new Store(dbPath).close()).not.toThrow();
  });
});
