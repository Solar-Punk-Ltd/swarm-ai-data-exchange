import { formatUnits } from 'viem';
import type { Currency } from '../config/currencies';
import styles from './styles.module.css';

/**
 * Format an amount with its own currency's decimals.
 *
 * Always via `formatUnits` — USDC is 6 decimals and ETH is 18, and dividing by the wrong one is
 * the classic silent bug on this kind of screen. Rendered at fixed width so values do not jitter
 * on every poll.
 */
export function formatAmount(amount: bigint, currency: Currency): string {
  const places = currency.displayDecimals ?? 4;
  const exact = Number(formatUnits(amount, currency.decimals));
  return exact.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** A pulsing placeholder. A real 0 and an unloaded value must never look the same. */
export function Skeleton({ width = 64 }: { width?: number }) {
  return <span className={styles.skeleton} style={{ minWidth: width }} aria-hidden />;
}

export interface BalanceProps {
  /** Undefined means "not loaded yet" and renders a skeleton. */
  amount: bigint | undefined;
  currency: Currency;
  className?: string;
}

export default function Balance({ amount, currency, className }: BalanceProps) {
  if (amount === undefined) return <Skeleton />;
  return (
    <span className={className}>
      {formatAmount(amount, currency)}
      <span className={styles.inlineBalanceUnit}>{currency.symbol}</span>
    </span>
  );
}
