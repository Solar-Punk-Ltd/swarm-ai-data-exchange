import { useMemo, useState } from 'react';
import { config } from '../config/env';
import { txUrl } from '../config/chain';
import { useMarketplace } from '../context/MarketplaceContext';
import { formatAge } from '../lib/format';
import type { HistoryEntry } from '../lib/history';
import AddressLink from './AddressLink';
import { formatAmount } from './Balance';
import styles from './styles.module.css';

/**
 * Which seller a row belongs to. Rows are keyed by splitter because that is what the log
 * carries; the seller EOA and agent label are joined in from the registry.
 */
function useSellerLabel(splitter: string) {
  const { registry, agentLinks } = useMarketplace();
  return useMemo(() => {
    const record = registry?.sellers.find(
      (s) => s.splitter.toLowerCase() === splitter.toLowerCase(),
    );
    const link = agentLinks.bySplitter.get(splitter.toLowerCase());
    return { seller: record?.seller, agentName: link?.card?.name, agentId: link?.agentId };
  }, [registry, agentLinks, splitter]);
}

function HistoryRow({ entry, showSeller }: { entry: HistoryEntry; showSeller: boolean }) {
  const { seller, agentName, agentId } = useSellerLabel(entry.splitter);
  const href = txUrl(config.chain, entry.txHash);
  const isPurchase = entry.kind === 'purchase';

  return (
    <div className={styles.historyRow}>
      <span
        className={`${styles.historyKind} ${isPurchase ? styles.historyKindBuy : styles.historyKindPay}`}
      >
        {isPurchase ? 'Purchase' : 'Payout'}
      </span>

      <span className={styles.historyAmount}>
        {formatAmount(entry.amount, entry.currency)}
        <span className={styles.inlineBalanceUnit}>{entry.currency.symbol}</span>
      </span>

      <span className={styles.historyParties}>
        {isPurchase ? (
          <>
            {entry.from ? <AddressLink address={entry.from} label="Buyer" /> : <span>—</span>}
            {showSeller && (
              <>
                <span className={styles.historyArrow}>→</span>
                <span className={styles.historySeller}>
                  {agentName ??
                    (agentId !== undefined ? `Agent #${agentId}` : undefined) ??
                    (seller ? <AddressLink address={seller} label="Seller" /> : 'Unknown seller')}
                </span>
              </>
            )}
          </>
        ) : (
          <span className={styles.historySplit}>
            {entry.sellerAmount !== undefined && entry.treasuryAmount !== undefined && (
              <>
                {formatAmount(entry.sellerAmount, entry.currency)} seller ·{' '}
                {formatAmount(entry.treasuryAmount, entry.currency)} treasury
              </>
            )}
            {showSeller && agentName && (
              <span className={styles.historySeller}> · {agentName}</span>
            )}
          </span>
        )}
      </span>

      <span className={styles.historyWhen} title={`Block ${entry.blockNumber}`}>
        {entry.timestamp ? formatAge(entry.timestamp, Date.now()) : `#${entry.blockNumber}`}
      </span>

      {href ? (
        <a
          className={styles.historyTx}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={entry.txHash}
        >
          tx
        </a>
      ) : (
        <span className={styles.historyTx} />
      )}
    </div>
  );
}

export interface HistoryTableProps {
  entries: HistoryEntry[];
  /** Hide the seller column when the table already sits inside one seller's card. */
  showSeller?: boolean;
  /** Rows to render before "show more". */
  initial?: number;
  emptyLabel?: string;
}

export default function HistoryTable({
  entries,
  showSeller = true,
  initial = 10,
  emptyLabel = 'No activity yet.',
}: HistoryTableProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return <div className={styles.historyEmpty}>{emptyLabel}</div>;
  }

  const shown = expanded ? entries : entries.slice(0, initial);

  return (
    <div className={styles.historyTable}>
      {shown.map((entry) => (
        // A tx can carry several matching logs, so the hash alone is not unique.
        <HistoryRow
          key={`${entry.txHash}-${entry.kind}-${entry.splitter}-${entry.amount}`}
          entry={entry}
          showSeller={showSeller}
        />
      ))}
      {entries.length > initial && (
        <button type="button" className={styles.historyMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show ${entries.length - initial} more`}
        </button>
      )}
    </div>
  );
}
