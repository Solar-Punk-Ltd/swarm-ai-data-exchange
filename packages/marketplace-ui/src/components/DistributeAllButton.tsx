import { useMemo } from 'react';
import { useMarketplace } from '../context/MarketplaceContext';
import { useWallet } from '../context/WalletContext';
import { useDistributeAll } from '../hooks/useDistributeAll';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { totalPending } from '../lib/reads';
import { formatAmount } from './Balance';
import TxNote from './TxNote';
import styles from './styles.module.css';

/**
 * Batch sweep across every funded clone.
 *
 * N sellers would otherwise be N transactions on the operator's wallet; the factory does it in
 * one. The label states the scope before signing, not after — an operator should know how many
 * clones and how much value a single signature is about to move.
 */
export default function DistributeAllButton() {
  const { balances, fundedSplitters, stale, loading } = useMarketplace();
  const { account, wrongChain } = useWallet();
  const { state, busy, distributeAllFunded } = useDistributeAll();

  // Total accrued across the funded set, per ERC-20. Native entries are excluded: a clone has no
  // `receive()`, so it cannot hold ETH at all.
  const totals = useMemo(() => {
    const tokens = erc20Currencies(config.currencies);
    return tokens.map((currency) => {
      const sum = fundedSplitters.reduce((acc, splitter) => {
        return acc + totalPending(balances?.splitters[splitter]?.[currency.symbol]);
      }, 0n);
      return { currency, sum };
    });
  }, [balances, fundedSplitters]);

  const blocked = !account || wrongChain;
  const disabled = fundedSplitters.length === 0 || busy || blocked;

  const scope =
    fundedSplitters.length === 0
      ? loading
        ? 'Checking balances…'
        : 'Nothing accrued'
      : `${fundedSplitters.length} clone${fundedSplitters.length === 1 ? '' : 's'} funded · ` +
        totals
          .filter((t) => t.sum > 0n)
          .map((t) => `${formatAmount(t.sum, t.currency)} ${t.currency.symbol}`)
          .join(' · ');

  const title = disabled
    ? fundedSplitters.length === 0
      ? 'No clone holds a balance'
      : !account
        ? 'Connect a wallet to distribute'
        : wrongChain
          ? 'Switch to the configured network first'
          : 'Distribution in progress'
    : stale
      ? 'Balance data is stale — this will fall back to sweeping the whole registry'
      : 'Sweep every funded clone in one transaction';

  return (
    <div className={styles.actionCell}>
      <button
        type="button"
        className={`${styles.button} ${styles.buttonPrimary}`}
        onClick={() => void distributeAllFunded()}
        disabled={disabled}
        title={title}
      >
        {busy ? 'Distributing…' : 'Distribute all'}
      </button>
      <span className={styles.txNote}>{scope}</span>
      <TxNote state={state} />
    </div>
  );
}
