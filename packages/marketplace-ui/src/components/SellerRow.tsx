import { useMarketplace } from '../context/MarketplaceContext';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { formatTaxBps } from '../lib/format';
import { isFunded, totalPending } from '../lib/reads';
import type { SellerRecord } from '../lib/reads';
import AddressLink from './AddressLink';
import Balance, { Skeleton, formatAmount } from './Balance';
import DistributeButton from './DistributeButton';
import styles from './styles.module.css';

export default function SellerRow({ record }: { record: SellerRecord }) {
  const { balances } = useMarketplace();

  const sellerBalances = balances?.sellers[record.seller];
  const pendingMap = balances?.splitters[record.splitter];
  const funded = isFunded(pendingMap);

  // ERC-20 only. RevenueSplitter has no receive(), so a clone's ETH balance is structurally zero
  // and rendering it here would read as a bug.
  const tokens = erc20Currencies(config.currencies);

  return (
    <div className={styles.sellerCard}>
      <div className={styles.sellerTop}>
        <AddressLink address={record.seller} label="Seller" />
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
    </div>
  );
}
