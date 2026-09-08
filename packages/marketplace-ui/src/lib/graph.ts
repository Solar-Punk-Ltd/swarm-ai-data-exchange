/**
 * The agent network, derived from data the dashboard already loads.
 *
 * Nothing here fetches. MarketplaceContext remains the single fetch owner; this is a second
 * reading of the same registry, agent links and log sweep the Dashboard renders as tables.
 *
 * The model is "one address, one node". A splitter clone is plumbing, not an actor: an agent's
 * clone, its seller EOA, its registered agent wallet and its NFT owner are all the same
 * participant, so they collapse onto a single node keyed by the clone. Without that collapse an
 * agent that both sells and buys renders as two disconnected dots — precisely the relationship
 * this view exists to show.
 *
 * Every key is a lowercased address. This is not cosmetic: `bySplitter` is keyed lowercase
 * (agents.ts), a purchase's `splitter` is a decoded log arg and therefore checksummed, and a
 * payout's is `log.address` and therefore not. Mixing them joins one kind of row and silently
 * drops the other.
 */
import type { Address } from 'viem';
import { HISTORY_LIMIT } from '../config/registry';
import type { AgentLinkIndex } from './agents';
import type { History, HistoryEntry } from './history';
import type { Registry } from './reads';

export type Period = '24h' | '7d' | '30d' | 'all';

export const PERIODS: { key: Period; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All' },
];

const PERIOD_MS: Record<Period, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type NodeRole = 'seller' | 'buyer' | 'treasury';
export type LinkKind = 'purchase' | 'payout';

/** symbol -> amount. Never a bare bigint: USDC is 6 decimals and ETH is 18. */
export type VolumeMap = Map<string, bigint>;

export interface GraphNode {
  /** Lowercased address. Never role-prefixed — prefixing recreates the duplicate it prevents. */
  id: string;
  /** Checksummed form, for display and explorer links. */
  address: Address;
  label: string;
  /** A participant can be more than one thing at once, so this is a set rather than a type. */
  roles: Set<NodeRole>;
  splitter?: Address;
  sellerEoa?: Address;
  agentId?: bigint;
  /**
   * Avatar to draw in place of the dot, from the agent's card.
   *
   * Set only for a `verified` link. An image reads as identity far more strongly than a name
   * does, and `unverified` / `disputed` are exactly the claims `AgentBadge` refuses to endorse —
   * putting a face on one would lend the map's authority to something unproven.
   */
  avatarUrl?: string;
  /** Received, within the period. */
  volumeIn: VolumeMap;
  /** Sent, within the period. */
  volumeOut: VolumeMap;
  /** Purchases this node was either side of, within the period. */
  txCount: number;
  counterparties: Set<string>;
  /** Distributed to this seller, within the period. */
  paidToSeller: VolumeMap;
  /** Tax this seller sent on to the treasury, within the period. */
  paidToTreasury: VolumeMap;
  /**
   * Stamped by force-graph's simulation, not by the derivation. Declared so the canvas can read
   * them, and as a reminder that these objects are mutated in place — which is exactly why
   * `reconcile` reuses them rather than allocating fresh ones.
   */
  x?: number;
  y?: number;
}

export interface GraphLink {
  /** Stable identity across derives: endpoints plus kind. */
  key: string;
  source: string;
  target: string;
  kind: LinkKind;
  value: VolumeMap;
  count: number;
}

export interface Truncation {
  /** The sweep was cut short by the chunk ceiling or a node error, so absence proves nothing. */
  partial: boolean;
  /** History filled to HISTORY_LIMIT, so anything older than `oldest` was discarded. */
  capped: boolean;
  /** Timestamp of the oldest retained event, when it is known. */
  oldest?: number;
  /** The selected period reaches further back than the retained data does. */
  incomplete: boolean;
}

export interface DerivedGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  truncation: Truncation;
  /** Purchases counted, within the period. */
  purchases: number;
}

export interface DeriveGraphInput {
  registry: Registry | undefined;
  agentLinks: AgentLinkIndex;
  history: History;
  treasury: Address;
  period: Period;
  now: number;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function addVolume(map: VolumeMap, symbol: string, amount: bigint): void {
  map.set(symbol, (map.get(symbol) ?? 0n) + amount);
}

/** Total for one symbol; 0n when this node never saw that currency. */
export function volumeOf(map: VolumeMap, symbol: string): bigint {
  return map.get(symbol) ?? 0n;
}

export function periodCutoff(period: Period, now: number): number | null {
  const span = PERIOD_MS[period];
  return span === null ? null : now - span;
}

/**
 * An entry with no timestamp counts as inside every period.
 *
 * `loadHistory` returns rows untimed and `attachTimestamps` fills them in a second pass, so a
 * filter that excluded them would empty itself on every sweep. Entries arrive newest-first, so an
 * unknown time is almost always a recent block: including them makes the view a slight superset
 * that settles as timestamps land, rather than one that blinks empty and refills.
 */
function inPeriod(entry: HistoryEntry, cutoff: number | null): boolean {
  if (cutoff === null) return true;
  if (entry.timestamp === undefined) return true;
  return entry.timestamp >= cutoff;
}

export function deriveGraph(input: DeriveGraphInput): DerivedGraph {
  const { registry, agentLinks, history, treasury, period, now } = input;

  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();
  /** Any address belonging to a participant -> that participant's node id. */
  const canonical = new Map<string, string>();

  const alias = (address: string | undefined, nodeId: string): void => {
    if (!address) return;
    const key = address.toLowerCase();
    if (!canonical.has(key)) canonical.set(key, nodeId);
  };
  const resolve = (address: string): string => {
    const key = address.toLowerCase();
    return canonical.get(key) ?? key;
  };

  const ensure = (id: string, address: Address): GraphNode => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        address,
        label: shortAddress(address),
        roles: new Set<NodeRole>(),
        volumeIn: new Map(),
        volumeOut: new Map(),
        txCount: 0,
        counterparties: new Set(),
        paidToSeller: new Map(),
        paidToTreasury: new Map(),
      };
      nodes.set(id, node);
    }
    return node;
  };

  // Sellers. Every registered clone gets a node, whether or not it has ever been paid: an agent
  // that has sold nothing is a fact about the marketplace, not an absence of one.
  for (const seller of registry?.sellers ?? []) {
    const id = seller.splitter.toLowerCase();
    const node = ensure(id, seller.splitter);
    node.roles.add('seller');
    node.splitter = seller.splitter;
    node.sellerEoa = seller.seller;

    const link = agentLinks.bySplitter.get(id);
    if (link) {
      node.agentId = link.agentId;
      node.label = link.card?.name ?? `Agent #${link.agentId}`;
      // Assigned on every pass rather than only when there is something to assign, so that
      // `reconcile`'s Object.assign can clear it: a link that loses its verified status has to
      // lose its face too, and a key that is never written is a key that never overwrites.
      node.avatarUrl = link.status === 'verified' ? link.card?.image : undefined;
    }

    alias(seller.splitter, id);
    alias(seller.seller, id);
    alias(link?.agentWallet, id);
    alias(link?.owner, id);
  }

  // Treasury, resolved rather than assumed: in a demo config the treasury can legitimately also
  // be a seller's EOA, in which case it is that same participant wearing a second hat.
  const treasuryId = resolve(treasury);
  const treasuryNode = ensure(treasuryId, treasury);
  treasuryNode.roles.add('treasury');
  if (treasuryNode.roles.size === 1) treasuryNode.label = 'Treasury';
  alias(treasury, treasuryId);

  const cutoff = periodCutoff(period, now);
  let purchases = 0;

  const addLink = (
    source: string,
    target: string,
    kind: LinkKind,
    symbol: string,
    amount: bigint,
  ): void => {
    const key = `${source}>${target}>${kind}`;
    let link = links.get(key);
    if (!link) {
      link = { key, source, target, kind, value: new Map(), count: 0 };
      links.set(key, link);
    }
    addVolume(link.value, symbol, amount);
    link.count += 1;
  };

  for (const entry of history.entries) {
    if (!inPeriod(entry, cutoff)) continue;

    const splitterId = resolve(entry.splitter);
    const symbol = entry.currency.symbol;

    if (entry.kind === 'purchase') {
      // `loadHistory` deliberately keeps transfers from non-buyers — money in is money in — so a
      // faucet or a manual top-up shows up here as a counterparty. That is a labelling caveat,
      // not something to filter away. What is dropped is only what cannot be an edge at all.
      if (!entry.from || entry.from.toLowerCase() === ZERO_ADDRESS) continue;
      const buyerId = resolve(entry.from);
      if (buyerId === splitterId) continue;

      const sellerNode = ensure(splitterId, entry.splitter);
      const buyerNode = ensure(buyerId, entry.from);
      buyerNode.roles.add('buyer');

      addVolume(sellerNode.volumeIn, symbol, entry.amount);
      addVolume(buyerNode.volumeOut, symbol, entry.amount);
      sellerNode.txCount += 1;
      buyerNode.txCount += 1;
      sellerNode.counterparties.add(buyerId);
      buyerNode.counterparties.add(splitterId);

      addLink(buyerId, splitterId, 'purchase', symbol, entry.amount);
      purchases += 1;
      continue;
    }

    // Payout. Both halves are recorded on the node, but only the treasury half becomes an edge:
    // the seller's own share moves from its clone to its EOA, and those are the same participant
    // here, so drawing it would be a self-loop. The node carries both figures so the treasury
    // edge is never mistaken for the whole distribution.
    const node = ensure(splitterId, entry.splitter);
    if (entry.sellerAmount !== undefined) addVolume(node.paidToSeller, symbol, entry.sellerAmount);
    if (entry.treasuryAmount !== undefined) {
      addVolume(node.paidToTreasury, symbol, entry.treasuryAmount);
      if (entry.treasuryAmount > 0n && splitterId !== treasuryId) {
        // The tax really did move between two participants, so it counts as volume on both —
        // otherwise the treasury shows a zero balance sheet while visibly collecting money.
        // `txCount` stays purchases-only, which is what the column claims to be.
        addVolume(node.volumeOut, symbol, entry.treasuryAmount);
        addVolume(treasuryNode.volumeIn, symbol, entry.treasuryAmount);
        node.counterparties.add(treasuryId);
        treasuryNode.counterparties.add(splitterId);
        addLink(splitterId, treasuryId, 'payout', symbol, entry.treasuryAmount);
      }
    }
  }

  // How much of this is the whole truth. The cap is exact, so the answer can be too: the view is
  // provably complete when the oldest event still retained predates the period's cutoff.
  const capped = history.entries.length >= HISTORY_LIMIT;
  let oldest: number | undefined;
  for (const entry of history.entries) {
    if (entry.timestamp === undefined) continue;
    if (oldest === undefined || entry.timestamp < oldest) oldest = entry.timestamp;
  }

  const incomplete = !capped
    ? false
    : cutoff === null || oldest === undefined
      ? true
      : oldest > cutoff;

  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
    truncation: { partial: history.partial, capped, oldest, incomplete },
    purchases,
  };
}

/**
 * A cheap stand-in for "the derived graph would differ".
 *
 * The context hands out a new value every 5s — `balances` is freshly allocated each tick — and a
 * new `history` with entirely new entry objects every 30s, so memoising on those references
 * re-derives constantly for no reason. The counts of timed entries, named cards and avatars are in
 * here because all three change as the second-pass fetches land, and all three change what is
 * rendered.
 */
export function graphSignature(
  registry: Registry | undefined,
  agentLinks: AgentLinkIndex,
  history: History,
  period: Period,
  now: number,
): string {
  const entries = history.entries;

  let timed = 0;
  for (const entry of entries) if (entry.timestamp !== undefined) timed += 1;

  let named = 0;
  let faced = 0;
  for (const link of agentLinks.bySplitter.values()) {
    if (link.card?.name) named += 1;
    // Counted separately from `named`: a card can carry an image and no name, and an avatar
    // changes both how a node is painted and its radius floor.
    if (link.status === 'verified' && link.card?.image) faced += 1;
  }

  // A bounded period's cutoff moves with the clock, so an idle page must still re-derive
  // occasionally or nothing would ever age out. One derive a minute over <=200 entries is free.
  const bucket = PERIOD_MS[period] === null ? 0 : Math.floor(now / 60_000);

  return [
    period,
    bucket,
    registry?.sellers.length ?? -1,
    agentLinks.bySplitter.size,
    named,
    faced,
    entries.length,
    timed,
    entries[0]?.txHash ?? '',
    entries[entries.length - 1]?.txHash ?? '',
    history.partial ? 'p' : '',
  ].join('|');
}

/**
 * Merge a fresh derivation into the objects the canvas is already animating.
 *
 * force-graph stamps `x/y/vx/vy/index/__indexColor` onto the node objects it is given, and treats
 * an array of all-new objects as a new graph: it resets its colour tracker and re-seeds d3, which
 * throws the layout across the canvas. Reusing the object for an id we already had keeps those
 * stamps, so a refresh nudges the simulation instead of restarting it.
 *
 * Links are reused for the same reason, and their endpoints are rewritten back to ids because
 * force-graph replaces them with node references in place.
 */
export function reconcile(
  liveNodes: Map<string, GraphNode>,
  liveLinks: Map<string, GraphLink>,
  next: DerivedGraph,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = next.nodes.map((fresh) => {
    const live = liveNodes.get(fresh.id);
    if (!live) {
      liveNodes.set(fresh.id, fresh);
      return fresh;
    }
    Object.assign(live, fresh);
    return live;
  });

  const links = next.links.map((fresh) => {
    const live = liveLinks.get(fresh.key);
    if (!live) {
      liveLinks.set(fresh.key, fresh);
      return fresh;
    }
    Object.assign(live, fresh);
    return live;
  });

  const keptNodes = new Set(nodes.map((n) => n.id));
  for (const id of [...liveNodes.keys()]) if (!keptNodes.has(id)) liveNodes.delete(id);
  const keptLinks = new Set(links.map((l) => l.key));
  for (const key of [...liveLinks.keys()]) if (!keptLinks.has(key)) liveLinks.delete(key);

  return { nodes, links };
}
