/**
 * Map of Agents.
 *
 * Who is trading with whom: agents are nodes, the payments between them are edges. Same data as
 * the Dashboard's Activity table, read as a network instead of a list.
 *
 * This page owns three things the pieces below it must not: the period filter, the memo gate that
 * stops the 5s balance tick from re-deriving a graph that has not changed, and the live node
 * objects the canvas mutates in place.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { useMarketplace } from '../context/MarketplaceContext';
import { formatAge } from '../lib/format';
import { deriveGraph, graphSignature, reconcile, volumeOf, PERIODS } from '../lib/graph';
import type { GraphLink, GraphNode, NodeRole, Period } from '../lib/graph';
import AddressLink from './AddressLink';
import AgentGraph, { colorForRoles } from './AgentGraph';
import AgentTable from './AgentTable';
import { formatAmount } from './Balance';
import StaleBanner from './StaleBanner';
import styles from './styles.module.css';

type LegendRole = NodeRole | 'both';

const LEGEND: { label: string; role: LegendRole }[] = [
  { label: 'Seller', role: 'seller' },
  { label: 'Buyer', role: 'buyer' },
  { label: 'Both', role: 'both' },
  { label: 'Treasury', role: 'treasury' },
];

function legendColor(role: LegendRole): string {
  const roles = new Set<NodeRole>(role === 'both' ? ['seller', 'buyer'] : [role]);
  return colorForRoles(roles);
}

export default function MapPage() {
  const { registry, agentLinks, history, loading } = useMarketplace();
  const [period, setPeriod] = useState<Period>('7d');
  const [selectedId, setSelectedId] = useState<string>();

  // The objects force-graph is animating. Kept across derives so the layout is nudged rather than
  // thrown across the canvas every time the sweep returns.
  const liveNodes = useRef(new Map<string, GraphNode>());
  const liveLinks = useRef(new Map<string, GraphLink>());

  const now = Date.now();
  const signature = graphSignature(registry, agentLinks, history, period, now);

  const graph = useMemo(
    () => {
      const derived = deriveGraph({
        registry,
        agentLinks,
        history,
        treasury: config.treasury,
        period,
        now,
      });
      const { nodes, links } = reconcile(liveNodes.current, liveLinks.current, derived);
      return { nodes, links, truncation: derived.truncation, purchases: derived.purchases };
    },
    // Gated on the signature alone, on purpose. `registry`, `agentLinks` and `history` are handed
    // out as fresh objects every few seconds whether or not anything changed, so listing them here
    // would re-derive — and reheat the simulation — constantly. Nothing enforces this either way:
    // `eslint-plugin-react-hooks` is not installed in this repo.
    [signature],
  );

  const selected = selectedId ? graph.nodes.find((node) => node.id === selectedId) : undefined;
  const onSelect = useCallback((node: GraphNode | undefined) => setSelectedId(node?.id), []);

  const settlement = erc20Currencies(config.currencies)[0];
  const sellers = registry?.sellers.length ?? 0;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Map of Agents</h2>
        <span className={styles.sectionMeta}>
          {sellers} agent{sellers === 1 ? '' : 's'} · {graph.purchases} purchase
          {graph.purchases === 1 ? '' : 's'} · {graph.links.length} edge
          {graph.links.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className={styles.historyFilters}>
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`${styles.historyFilter} ${period === key ? styles.historyFilterOn : ''}`}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <StaleBanner />

      {!config.identityRegistry && (
        <div className={styles.banner}>
          No ERC-8004 Identity Registry is configured for {config.chain.name}, so the activity sweep
          never runs and no edges can be drawn. Agents below are the registered clones only. Set
          VITE_IDENTITY_REGISTRY_ADDRESS to enable it.
        </div>
      )}

      {history.partial && (
        <div className={styles.banner}>
          The log sweep was cut short, so edges are missing and no absence here proves anything.
          Lower VITE_LOG_CHUNK_BLOCKS, raise VITE_IDENTITY_REGISTRY_FROM_BLOCK, or use an RPC that
          allows wider ranges.
        </div>
      )}

      {graph.truncation.incomplete && (
        <div className={styles.banner}>
          Only the most recent {history.entries.length} events are retained
          {graph.truncation.oldest !== undefined && (
            <> — the earliest is {formatAge(graph.truncation.oldest, now)}</>
          )}
          , so the {PERIODS.find((p) => p.key === period)?.label} view is incomplete. Shorter
          periods still show everything.
        </div>
      )}

      <div className={styles.graphLegend}>
        {LEGEND.map((item) => (
          <span key={item.role} className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ background: legendColor(item.role) }}
              aria-hidden
            />
            {item.label}
          </span>
        ))}
        <span className={styles.legendHint}>
          Edge thickness is transfer count. Drag to rearrange, scroll to zoom, click a node to pin
          it.
        </span>
      </div>

      {loading && !registry ? (
        <div className={styles.historyEmpty}>Loading…</div>
      ) : graph.nodes.length === 0 ? (
        <div className={styles.historyEmpty}>No agents registered in the factory yet.</div>
      ) : (
        <AgentGraph
          nodes={graph.nodes}
          links={graph.links}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}

      {selected && (
        <div className={styles.nodeDetail}>
          <div className={styles.nodeDetailHead}>
            <span className={styles.agentLabel}>{selected.label}</span>
            <AddressLink address={selected.address} />
          </div>
          <div className={styles.nodeDetailGrid}>
            <span>
              Received
              <strong>
                {formatAmount(volumeOf(selected.volumeIn, settlement.symbol), settlement)}{' '}
                {settlement.symbol}
              </strong>
            </span>
            <span>
              Sent
              <strong>
                {formatAmount(volumeOf(selected.volumeOut, settlement.symbol), settlement)}{' '}
                {settlement.symbol}
              </strong>
            </span>
            <span>
              Purchases<strong>{selected.txCount}</strong>
            </span>
            <span>
              Counterparties<strong>{selected.counterparties.size}</strong>
            </span>
            {selected.roles.has('seller') && (
              <>
                <span>
                  Distributed to seller
                  <strong>
                    {formatAmount(volumeOf(selected.paidToSeller, settlement.symbol), settlement)}{' '}
                    {settlement.symbol}
                  </strong>
                </span>
                <span>
                  Tax to treasury
                  <strong>
                    {formatAmount(volumeOf(selected.paidToTreasury, settlement.symbol), settlement)}{' '}
                    {settlement.symbol}
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <AgentTable nodes={graph.nodes} selectedId={selectedId} onSelect={onSelect} />
    </section>
  );
}
