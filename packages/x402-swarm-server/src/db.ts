import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

// Local persistent store for the nonce set (replay prevention) and purchase records.
// Both tables are written at step 9 of the purchase flow (after /settle, before ACT grant).
export class Store {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nonces (
        nonce   TEXT PRIMARY KEY,
        used_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purchases (
        consumer_address TEXT NOT NULL,
        item_id          TEXT NOT NULL,
        tx_hash          TEXT NOT NULL,
        settled_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS purchases_item_id ON purchases(item_id);
      CREATE INDEX IF NOT EXISTS purchases_consumer ON purchases(consumer_address);
    `);
    this.migrate();
  }

  // Additive migrations for DBs created by an earlier build. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so check the table shape first.
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(purchases)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((c) => c.name === 'pay_to')) {
      // Settlement destination. Recorded so a later Proof-of-Purchase check can confirm the
      // payment went through the seller's split contract (the taxed path) rather than a
      // side-channel address. Nullable: rows written before this column existed have no value.
      this.db.exec('ALTER TABLE purchases ADD COLUMN pay_to TEXT');
    }
  }

  // Step 7: freshness check — does NOT write (nonce is only burned after settlement).
  isNonceUsed(nonce: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM nonces WHERE nonce = ?').get(nonce);
    return row !== undefined;
  }

  // Step 9: burn the nonce once payment is confirmed.
  recordNonce(nonce: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO nonces (nonce, used_at) VALUES (?, ?)')
      .run(nonce, new Date().toISOString());
  }

  // Step 9: record the settled purchase (used by the indexer to cross-reference feedback).
  recordPurchase(
    consumerAddress: string,
    itemId: string,
    txHash: string,
    settledAt: string,
    payTo?: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO purchases (consumer_address, item_id, tx_hash, settled_at, pay_to) VALUES (?, ?, ?, ?, ?)',
      )
      .run(consumerAddress, itemId, txHash, settledAt, payTo ?? null);
  }

  close(): void {
    this.db.close();
  }
}
