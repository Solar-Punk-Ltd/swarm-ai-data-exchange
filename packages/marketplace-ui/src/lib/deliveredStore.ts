import { parseVoucher, type Claim, type ClaimItem } from './devcon';

/**
 * Keeps a delivered claim in this browser so a reload does not lose it.
 *
 * The voucher's private key exists nowhere else once the claim is released: the voucher server
 * stores nothing, and the orchestration API drops the key ~30s after delivery and serves a redacted
 * copy from then on. Holding it in memory alone meant a reload lost the wallet for good.
 *
 * The record stays until the visitor copies the key, or `MAX_AGE_MS` passes. Copying strips the
 * key but keeps the record: it is also what tells a reloaded page that a purchase already
 * happened. Without it the page offers Start again, and `createClaim` for a released claim deploys
 * a second funded agent rather than reattaching.
 *
 * Every access is wrapped: private browsing can throw on read and write, and the page must then
 * behave exactly as it did before this existed — memory only.
 */

const KEY = 'devcon.delivered';
const VERSION = 1;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredRecord {
  v: typeof VERSION;
  token: string;
  claimId: string;
  /** When the item was first stored. Rewrites keep it, so the age counts from delivery. */
  storedAt: number;
  confirmed: boolean;
  claim: Claim;
}

export interface Delivered {
  claim: Claim;
  confirmed: boolean;
}

/**
 * Whether this item is the richest form of itself the page will ever be handed.
 *
 * For a voucher that means the private key is present. A non-voucher item is complete as soon as
 * its content is present: there is no second, richer form of it to wait for.
 */
export function isCompleteItem(item: ClaimItem | null | undefined): boolean {
  if (!item || item.content === null) return false;
  const voucher = parseVoucher(item.content);
  return voucher ? Boolean(voucher.privateKey) : true;
}

function isRecord(value: unknown): value is StoredRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<StoredRecord>;
  return (
    r.v === VERSION &&
    typeof r.token === 'string' &&
    typeof r.claimId === 'string' &&
    typeof r.storedAt === 'number' &&
    typeof r.confirmed === 'boolean' &&
    typeof r.claim === 'object' &&
    r.claim !== null &&
    r.claim.claimId === r.claimId &&
    Array.isArray(r.claim.history)
  );
}

function read(): StoredRecord | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
    localStorage.removeItem(KEY);
  } catch {
    // Unreadable or unparsable: behave as if nothing was stored.
  }
  return undefined;
}

function write(record: StoredRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Quota or private mode. The in-memory copy still covers this page load.
  }
}

/** The delivered claim for this session token, if one is stored and not expired. */
export function loadDelivered(token: string): Delivered | undefined {
  const record = read();
  if (!record || record.token !== token) return undefined;
  if (Date.now() - record.storedAt > MAX_AGE_MS) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to do — it is rejected either way.
    }
    return undefined;
  }
  return { claim: record.claim, confirmed: record.confirmed };
}

/**
 * Stores a claim whose item is complete. A no-op once the visitor has copied the key, so a later
 * poll cannot write it back after it was removed.
 */
export function saveDelivered(token: string, claim: Claim): void {
  if (!isCompleteItem(claim.item)) return;
  const existing = read();
  const same = existing && existing.token === token && existing.claimId === claim.claimId;
  if (same && existing.confirmed) return;
  write({
    v: VERSION,
    token,
    claimId: claim.claimId,
    storedAt: same ? existing.storedAt : Date.now(),
    confirmed: false,
    claim,
  });
}

/** Strips the private key from the stored record once it is copied. Keeps the record. */
export function confirmDelivered(token: string): void {
  const existing = read();
  if (!existing || existing.token !== token) return;
  const item = existing.claim.item;
  const voucher = item ? parseVoucher(item.content) : null;
  let claim = existing.claim;
  if (item && voucher) {
    const { privateKey: _removed, ...rest } = voucher;
    const redacted = {
      ...rest,
      note: 'You copied this key, so it was removed from this browser.',
    };
    claim = { ...claim, item: { ...item, content: JSON.stringify(redacted) } };
  }
  write({ ...existing, confirmed: true, claim });
}
