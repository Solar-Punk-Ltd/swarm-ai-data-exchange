import { BPS_DENOMINATOR } from '@solarpunk/contracts';

/**
 * Basis points as a percentage. Derived from the SDK's `BPS_DENOMINATOR`, which mirrors the
 * on-chain constant — never a hardcoded 10000.
 */
export function formatTaxBps(bps: number): string {
  const percent = (bps * 100) / BPS_DENOMINATOR;
  return `${Number(percent.toFixed(2))}%`;
}

/** "12s ago" / "3m ago" — enough to tell a live tick from a stalled one. */
export function formatAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
