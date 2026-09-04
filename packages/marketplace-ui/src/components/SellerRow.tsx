import { useMemo, useState } from 'react';
import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { formatTaxBps } from '../lib/format';
import { isFunded, totalPending } from '../lib/reads';
import type { SellerRecord } from '../lib/reads';
import AddressLink from './AddressLink';
import AgentBadge from './AgentBadge';
import CatalogLink from './CatalogLink';
import Balance, { Skeleton, formatAmount } from './Balance';
import DistributeButton from './DistributeButton';
import HistoryTable from './HistoryTable';
import styles from './styles.module.css';

export default function SellerRow({ record }: { record: SellerRecord }) {
  const { balances, history } = useMarketplace();
  const [showHistory, setShowHistory] = useState(false);

  // Filtered from the single global sweep — a row must never fetch its own logs.
  const rowHistory = useMemo(
    () => history.entries.filter((e) => e.splitter.toLowerCase() === record.splitter.toLowerCase()),
    [history.entries, record.splitter],
  );

  const sellerBalances = balances?.sellers[record.seller];
  const pendingMap = balances?.splitters[record.splitter];
  const funded = isFunded(pendingMap);

  // ERC-20 only. RevenueSplitter has no receive(), so a clone's ETH balance is structurally zero
  // and rendering it here would read as a bug.
  const tokens = erc20Currencies(config.currencies);

  return (
    <div className={styles.sellerCard}>
      <div className={styles.sellerTop}>
        <div className={styles.splitterFacts}>
          <AddressLink address={record.seller} label="Seller" />
          <AgentBadge splitter={record.splitter} seller={record.seller} />
          <CatalogLink splitter={record.splitter} />
        </div>
        <div className={styles.inlineBalances}>
          {config.currencies.map((currency) => (
            <Balance
              key={currency.symbol}
              amount={sellerBalances?.[currency.symbol]}
              currency={currency}
            />
          ))}
        </div>
      </div>

      <div className={styles.splitterRow}>
        <div className={styles.splitterFacts}>
          <AddressLink address={record.splitter} label="Splitter" />
          <span className={styles.pill}>{formatTaxBps(record.taxBps)} tax</span>
        </div>

        <div className={styles.splitterFacts}>
          {tokens.map((currency) => {
            const split = pendingMap?.[currency.symbol];
            return (
              <div key={currency.symbol}>
                <div className={styles.accrued}>
                  {split === undefined ? (
                    <Skeleton />
                  ) : (
                    <>
                      {formatAmount(totalPending(split), currency)}
                      <span className={styles.inlineBalanceUnit}>{currency.symbol}</span>
                    </>
                  )}
                </div>
                {split !== undefined && (
                  <div className={styles.accruedSplit}>
                    {formatAmount(split.sellerAmount, currency)} seller ·{' '}
                    {formatAmount(split.treasuryAmount, currency)} treasury
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DistributeButton splitter={record.splitter} funded={funded} />
      </div>

      <div className={styles.historyToggleRow}>
        <button
          type="button"
          className={styles.historyToggle}
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
        >
          {showHistory ? '▾' : '▸'} Activity
          <span className={styles.historyCount}>{rowHistory.length}</span>
        </button>
      </div>

      {showHistory && (
        <HistoryTable
          entries={rowHistory}
          showSeller={false}
          initial={5}
          emptyLabel="No activity for this seller in the scanned window."
        />
      )}
    </div>
  );
}
