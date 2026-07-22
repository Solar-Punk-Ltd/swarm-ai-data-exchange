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
  recordPurchase(consumerAddress: string, itemId: string, txHash: string, settledAt: string): void {
    this.db
      .prepare(
        'INSERT INTO purchases (consumer_address, item_id, tx_hash, settled_at) VALUES (?, ?, ?, ?)',
      )
      .run(consumerAddress, itemId, txHash, settledAt);
  }

  close(): void {
    this.db.close();
  }
}
