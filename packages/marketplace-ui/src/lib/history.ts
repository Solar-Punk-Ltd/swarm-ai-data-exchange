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
import { chunkRangesNewestFirst, LOG_SWEEP_CONCURRENCY, sweepStart } from '../config/registry';

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
  // Spend the chunk budget on the newest blocks, not the oldest — see `sweepStart`.
  const { start, truncated } = sweepStart(head, fromBlock, chunkBlocks, maxChunks);
  let partial = truncated;

  // **Backward, from head**, in parallel groups. Not a style preference: the reasons a chunk
  // fails all live at the old end of the range. Public nodes prune logs (publicnode answers
  // `pruned history unavailable: … earliest available 46000000`), and a forward sweep meets that
  // wall on its FIRST request and aborts having read nothing — which is how this page rendered an
  // empty map and blamed the chunk size. Going backward, the newest data is already collected by
  // the time the wall is reached, and hitting it simply bounds how far back the view goes.
  const { ranges, exhausted } = chunkRangesNewestFirst(head, start, chunkBlocks, maxChunks);
  if (exhausted) partial = true;

  for (let i = 0; i < ranges.length; i += LOG_SWEEP_CONCURRENCY) {
    const group = ranges.slice(i, i + LOG_SWEEP_CONCURRENCY);
    const settledGroup = await Promise.all(
      group.map(([from, to]) =>
        Promise.all([
          // `to` is indexed, so one filter covers every clone.
          client.getLogs({
            address: tokens.map((c) => c.address),
            event: TRANSFER_EVENT,
            args: { to: splitters },
            fromBlock: from,
            toBlock: to,
          }),
          client.getLogs({
            address: splitters,
            event: DISTRIBUTED_EVENT,
            fromBlock: from,
            toBlock: to,
          }),
        ]).then(
          ([transfers, distributions]) => ({ ok: true as const, transfers, distributions }),
          (err: unknown) => ({ ok: false as const, err, from, to }),
        ),
      ),
    );

    let stop = false;
    for (const result of settledGroup) {
      if (!result.ok) {
        // The node's own message is the diagnosis: an over-wide chunk names its exact ceiling, a
        // pruned node names its earliest retained block. Swallowing it left the banner's generic
        // advice as the only signal, which is how an invalid chunk size went unnoticed.
        console.warn(
          `[history] log sweep stopped at blocks ${result.from}-${result.to}: ` +
            (result.err instanceof Error ? result.err.message : String(result.err)),
        );
        partial = true;
        stop = true;
        continue;
      }

      for (const log of result.transfers) {
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

      for (const log of result.distributions) {
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
    }
    if (stop) break;
  }

  return { entries: sortNewestFirst(entries).slice(0, limit), partial };
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
 * Fill in the timestamps that are already cached, synchronously.
 *
 * `loadHistory` returns rows with no timestamp at all, so anything rendered between the sweep and
 * `attachTimestamps` resolving sees every row as timeless — that window opens on *every* sweep,
 * not just the first. A consumer filtering by time would empty itself twice a minute. This costs
 * nothing and closes the window after the first sweep, since a settled block's timestamp is
 * cached for the life of the page.
 */
export function applyCachedTimestamps(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map((e) => ({ ...e, timestamp: blockTimes.get(e.blockNumber) }));
}

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
