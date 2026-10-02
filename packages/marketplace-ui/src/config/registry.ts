/**
 * ERC-8004 Identity Registry per chain — the source of the agent <-> splitter link.
 *
 * Mirrors CHAIN_DEFAULTS in erc8004-adapter/src/client.ts. Empty string means "not deployed on
 * this chain yet", in which case the dashboard simply omits agent identity: the link is
 * supplementary, never a reason to fail booting.
 */
export interface RegistryDeployment {
  address: string;
  /** Block the registry was deployed at. Scanning from 0 is not viable on a public node. */
  deployBlock: number;
}

export const IDENTITY_REGISTRIES: Record<number, RegistryDeployment> = {
  84532: { address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', deployBlock: 40400000 },
  8453: { address: '', deployBlock: 0 },
};

/**
 * How many blocks per `eth_getLogs` call.
 *
 * 50,000 is `base-sepolia-rpc.publicnode.com`'s documented ceiling, and the default endpoint is
 * chosen to match. This was 500,000, which **no public Base Sepolia node accepts** — publicnode
 * answers `-32701 exceed maximum block range: 50000` and `sepolia.base.org` caps at 1,000. Since
 * both sweeps abort on their first error, an over-wide chunk did not degrade the index, it
 * emptied it: the very first call threw and the sweep returned zero rows marked partial.
 *
 * Lower it if a different endpoint rejects 50,000. Note that `sepolia.base.org`'s 1,000-block cap
 * makes the Map of Agents impractical at any setting — covering a useful window would take
 * hundreds of sequential requests.
 */
export const DEFAULT_LOG_CHUNK_BLOCKS = 50_000;

/** Ceiling on chunks per sweep, so a misconfigured fromBlock cannot spin forever. */
export const MAX_LOG_CHUNKS = 40;

/**
 * Chunks fetched at once.
 *
 * Two, and the number is measured rather than chosen: against publicnode, a full window took
 * **36s sequential, 23s at 2, and 54s at 5**. More concurrency is slower, not faster — the same
 * per-second call metering that forced Multicall3 on the balance reads throttles parallel
 * `getLogs`, and the retries cost more than the overlap saves. Raise this only with a
 * measurement against the endpoint actually in use.
 */
export const LOG_SWEEP_CONCURRENCY = 2;

/**
 * The chunk ranges a sweep should fetch, **newest first**.
 *
 * Both sweeps walk backward from head, so a range that fails — a pruned node, a too-wide
 * request — costs only the history older than it, which is the half worth losing. A forward
 * sweep met those walls on its first request and returned nothing at all.
 */
export function chunkRangesNewestFirst(
  head: bigint,
  start: bigint,
  chunkBlocks: bigint,
  maxChunks: number,
): { ranges: Array<[bigint, bigint]>; exhausted: boolean } {
  const ranges: Array<[bigint, bigint]> = [];
  let cursor = head;
  while (cursor >= start && ranges.length < maxChunks) {
    const from = cursor - chunkBlocks + 1n > start ? cursor - chunkBlocks + 1n : start;
    ranges.push([from, cursor]);
    if (from === start) return { ranges, exhausted: false };
    cursor = from - 1n;
  }
  // Ran out of chunk budget before reaching `start`: older history exists and was not read.
  return { ranges, exhausted: cursor >= start };
}

/**
 * Where a chunked log sweep should actually start, and whether that skipped anything.
 *
 * A sweep can afford `maxChunks * chunkBlocks` blocks. When the configured `fromBlock` is further
 * back than that, **the recent end of the range is the half worth having** — this dashboard shows
 * newest-first rows under 24h/7d/30d filters and caps at `HISTORY_LIMIT`. At the current settings
 * the window is 2,000,000 blocks, roughly 46 days of Base Sepolia, which lines up with the
 * longest period filter the Map offers.
 *
 * Both sweeps used to walk forward from `fromBlock` and give up on the ceiling, which spent the
 * whole budget on the oldest blocks in the range. With the registry's `deployBlock` of 40,400,000
 * against a head near 47,500,000, that covered 40.4M–42.4M — a window this marketplace provably
 * never touched, since its earliest factory log is at 47,130,038. The Map rendered empty and
 * called itself partial, which was accurate and useless.
 *
 * `truncated` is what the "cut short" banner should reflect: older history exists and was not
 * read. It says nothing about the recent window, which is complete.
 */
export function sweepStart(
  head: bigint,
  fromBlock: bigint,
  chunkBlocks: bigint,
  maxChunks: number,
): { start: bigint; truncated: boolean } {
  const window = chunkBlocks * BigInt(maxChunks);
  const windowStart = head >= window ? head - window + 1n : 0n;
  return windowStart <= fromBlock
    ? { start: fromBlock, truncated: false }
    : { start: windowStart, truncated: true };
}

/**
 * Most history rows to keep after sorting. A marketplace that has run for months would
 * otherwise render thousands of rows and fetch a block timestamp for each.
 */
export const HISTORY_LIMIT = 200;
