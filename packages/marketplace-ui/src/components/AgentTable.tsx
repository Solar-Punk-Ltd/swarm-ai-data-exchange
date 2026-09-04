/**
 * The map's numbers, sortable.
 *
 * Amounts are per currency throughout — the settlement currency is picked explicitly and named in
 * the column headers rather than summed across decimals, which is the classic silent bug on this
 * screen. Everything shown covers the selected period only, over the events history retained.
 */
import { useMemo, useState } from 'react';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { useMarketplace } from '../context/MarketplaceContext';
import { totalPending } from '../lib/reads';
import { volumeOf } from '../lib/graph';
import type { GraphNode } from '../lib/graph';
import { formatAmount } from './Balance';
import styles from './styles.module.css';

type SortKey = 'label' | 'in' | 'out' | 'tx' | 'peers' | 'pending';

interface Column {
  key: SortKey;
  label: string;
  /** Sorting a name ascending is useful; sorting an amount ascending almost never is. */
  numeric: boolean;
  title?: string;
}

function roleLabel(node: GraphNode): string {
  const parts: string[] = [];
  if (node.roles.has('seller')) parts.push('Seller');
  if (node.roles.has('buyer')) parts.push('Buyer');
  if (node.roles.has('treasury')) parts.push('Treasury');
  return parts.join(' · ') || '—';
}

export interface AgentTableProps {
  nodes: GraphNode[];
  selectedId?: string;
  onSelect: (node: GraphNode | undefined) => void;
}

export default function AgentTable({ nodes, selectedId, onSelect }: AgentTableProps) {
  const { balances } = useMarketplace();
  const [sort, setSort] = useState<SortKey>('in');

  // Read inside the component, never at module scope: `config` is undefined when the app is
  // misconfigured, and App must be able to render its ConfigFailure page instead of crashing.
  const settlement = erc20Currencies(config.currencies)[0];

  const columns: Column[] = [
    { key: 'label', label: 'Agent', numeric: false },
    { key: 'in', label: `In (${settlement.symbol})`, numeric: true, title: 'Received in period' },
    { key: 'out', label: `Out (${settlement.symbol})`, numeric: true, title: 'Sent in period' },
    { key: 'tx', label: 'Txs', numeric: true, title: 'Purchases in period' },
    { key: 'peers', label: 'Peers', numeric: true, title: 'Distinct counterparties' },
    {
      key: 'pending',
      label: `Pending (${settlement.symbol})`,
      numeric: true,
      title: 'Undistributed balance held by this seller’s clone, right now — not period-scoped',
    },
  ];

  const pendingOf = (node: GraphNode): bigint => {
    if (!node.splitter || !balances) return 0n;
    return totalPending(balances.splitters[node.splitter]?.[settlement.symbol]);
  };

  const rows = useMemo(() => {
    const compare = (a: GraphNode, b: GraphNode): number => {
      switch (sort) {
        case 'label':
          return a.label.localeCompare(b.label);
        case 'out': {
          const diff =
            volumeOf(b.volumeOut, settlement.symbol) - volumeOf(a.volumeOut, settlement.symbol);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        }
        case 'tx':
          return b.txCount - a.txCount;
        case 'peers':
          return b.counterparties.size - a.counterparties.size;
        case 'pending': {
          const diff = pendingOf(b) - pendingOf(a);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        }
        default: {
          const diff =
            volumeOf(b.volumeIn, settlement.symbol) - volumeOf(a.volumeIn, settlement.symbol);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        }
      }
    };
    // Stable tiebreak on id, so equal rows do not reshuffle between polls.
    return [...nodes].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  }, [nodes, sort, balances, settlement.symbol]);

  if (nodes.length === 0) return null;

  return (
    <div className={styles.agentTable}>
      <div className={styles.agentHead}>
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            title={column.title}
            className={`${styles.agentHeadCell} ${column.numeric ? styles.agentNumeric : ''} ${
              sort === column.key ? styles.agentHeadCellOn : ''
            }`}
            onClick={() => setSort(column.key)}
          >
            {column.label}
            {sort === column.key && <span className={styles.agentSortMark}>▾</span>}
          </button>
        ))}
      </div>

      {rows.map((node) => (
        <button
          key={node.id}
          type="button"
          title={node.address}
          className={`${styles.agentRow} ${node.id === selectedId ? styles.agentRowOn : ''}`}
          onClick={() => onSelect(node.id === selectedId ? undefined : node)}
        >
          <span className={styles.agentName}>
            <span className={styles.agentLabel}>{node.label}</span>
            <span className={styles.agentRole}>{roleLabel(node)}</span>
          </span>
          <span className={styles.agentNumeric}>
            {formatAmount(volumeOf(node.volumeIn, settlement.symbol), settlement)}
          </span>
          <span className={styles.agentNumeric}>
            {formatAmount(volumeOf(node.volumeOut, settlement.symbol), settlement)}
          </span>
          <span className={styles.agentNumeric}>{node.txCount}</span>
          <span className={styles.agentNumeric}>{node.counterparties.size}</span>
          <span className={styles.agentNumeric}>
            {node.splitter ? formatAmount(pendingOf(node), settlement) : '—'}
          </span>
        </button>
      ))}
    </div>
  );
}
