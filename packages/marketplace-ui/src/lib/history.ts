/**
 * Marketplace transaction history, read entirely from chain logs.
 *
 * Two flows make up the money cycle this dashboard is about:
 *
 *   purchase — an ERC-20 Transfer INTO a splitter clone. Every x402 settlement is a
 *              `transferWithAuthorization` from the buyer to the seller's clone, which emits
 *              a plain Transfer, so the buyer is the log's `from`.
 *   payout   — `Distributed` on a clone, emitted when someone presses Distribute.
 *
 * Both filter on indexed args across ALL clones at once, so a sweep is two `getLogs` per
 * chunk regardless of how many sellers exist — never one request per seller.
 *
 * What is deliberately NOT here: which dataset was bought. The item id never reaches the
 * chain (it lives in each x402 server's local SQLite), so a purchase row can say who paid
 * whom and how much, and must not pretend to say more.
 */
import { erc20Abi, parseAbiItem } from 'viem';
import type { Address, PublicClient } from 'viem';
import { erc20Currencies, type Currency } from '../config/currencies';

const DISTRIBUTED_EVENT = parseAbiItem(
  'event Distributed(address indexed token, uint256 sellerAmount, uint256 treasuryAmount)',
);

const TRANSFER_EVENT = erc20Abi.find((item) => item.type === 'event' && item.name === 'Transfer')!;

export type EntryKind = 'purchase' | 'payout';

export interface HistoryEntry {
  kind: EntryKind;
  /** Clone the money moved into (purchase) or out of (payout). Joins a row to its seller. */
  splitter: Address;
  /** Buyer address. Purchases only — a payout has no counterparty worth naming. */
  from?: Address;
  currency: Currency;
  /** Purchase: amount paid. Payout: seller + treasury combined. */
  amount: bigint;
  /** Payout only — how the total was split. */
  sellerAmount?: bigint;
  treasuryAmount?: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  /** Unix ms. Undefined until the block timestamp is resolved (see attachTimestamps). */
  timestamp?: number;
}

export interface History {
  entries: HistoryEntry[];
  /** True when the scan hit its chunk ceiling or a node error: the list is incomplete. */
  partial: boolean;
}

export const EMPTY_HISTORY: History = { entries: [], partial: false };

/** Newest first, with a stable tiebreak so equal-block rows do not reshuffle between polls. */
function sortNewestFirst(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
    return a.txHash === b.txHash ? 0 : a.txHash > b.txHash ? -1 : 1;
  });
}

export interface LoadHistoryOptions {
  splitters: Address[];
  currencies: Currency[];
  fromBlock: bigint;
  chunkBlocks: bigint;
  maxChunks: number;
  /** Cap on rows kept, applied after sorting. Keeps a long-lived marketplace bounded. */
  limit: number;
}

/**
 * Sweep the configured window for purchases and payouts.
 *
 * Mirrors `readClaims` in agents.ts: chunked, ceiling-bounded, and degrading to `partial`
 * rather than throwing — an incomplete history is worth showing, a crashed dashboard is not.
 */
export async function loadHistory(
  client: PublicClient,
  options: LoadHistoryOptions,
): Promise<History> {
  const { splitters, currencies, fromBlock, chunkBlocks, maxChunks, limit } = options;
  if (splitters.length === 0) return EMPTY_HISTORY;

  const tokens = erc20Currencies(currencies);
  const byAddress = new Map(tokens.map((c) => [c.address.toLowerCase(), c as Currency]));
  const cloneSet = new Set(splitters.map((s) => s.toLowerCase()));

  const head = await client.getBlockNumber();
  const entries: HistoryEntry[] = [];
  let cursor = fromBlock;
  let chunks = 0;

  while (cursor <= head) {
    if (chunks >= maxChunks)
      return { entries: sortNewestFirst(entries).slice(0, limit), partial: true };
    const to = cursor + chunkBlocks - 1n > head ? head : cursor + chunkBlocks - 1n;

    try {
      const [transfers, distributions] = await Promise.all([
        // `to` is indexed, so one filter covers every clone.
        client.getLogs({
          address: tokens.map((c) => c.address),
          event: TRANSFER_EVENT,
          args: { to: splitters },
          fromBlock: cursor,
          toBlock: to,
        }),
        client.getLogs({
          address: splitters,
          event: DISTRIBUTED_EVENT,
          fromBlock: cursor,
          toBlock: to,
        }),
      ]);

      for (const log of transfers) {
        const currency = byAddress.get(log.address.toLowerCase());
        const to_ = log.args.to;
        const value = log.args.value;
        if (!currency || !to_ || value === undefined) continue;
        // A clone can also receive from a non-buyer; the row is still money in, so keep it.
        if (!cloneSet.has(to_.toLowerCase())) continue;
        entries.push({
          kind: 'purchase',
          splitter: to_,
          from: log.args.from,
          currency,
          amount: value,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
        });
      }

      for (const log of distributions) {
        const token = log.args.token;
        const sellerAmount = log.args.sellerAmount;
        const treasuryAmount = log.args.treasuryAmount;
        const currency = token ? byAddress.get(token.toLowerCase()) : undefined;
        if (!currency || sellerAmount === undefined || treasuryAmount === undefined) continue;
        entries.push({
          kind: 'payout',
          splitter: log.address,
          currency,
          amount: sellerAmount + treasuryAmount,
          sellerAmount,
          treasuryAmount,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
        });
      }
    } catch {
      return { entries: sortNewestFirst(entries).slice(0, limit), partial: true };
    }

    cursor = to + 1n;
    chunks += 1;
  }

  return { entries: sortNewestFirst(entries).slice(0, limit), partial: false };
}

/**
 * Block timestamps, cached for the life of the page.
 *
 * A settled block's timestamp never changes, and the sweep re-runs every few ticks over
 * largely the same rows — without this, every refresh would re-fetch every timestamp it
 * already had. Bounded by HISTORY_LIMIT distinct blocks in practice.
 */
const blockTimes = new Map<bigint, number>();

/**
 * Fill in wall-clock times for the rows on screen.
 *
 * Runs only over rows that survived the limit and dedupes by block, so a busy block costs
 * one request rather than one per row — and nothing already cached is fetched again.
 * Failure is silent: a row without a time still shows its block number.
 */
export async function attachTimestamps(
  client: PublicClient,
  entries: HistoryEntry[],
): Promise<HistoryEntry[]> {
  const missing = [...new Set(entries.map((e) => e.blockNumber))].filter((b) => !blockTimes.has(b));

  await Promise.all(
    missing.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        blockTimes.set(blockNumber, Number(block.timestamp) * 1000);
      } catch {
        /* leave undefined; retried on the next sweep */
      }
    }),
  );

  return entries.map((e) => ({ ...e, timestamp: blockTimes.get(e.blockNumber) }));
}
