import { useCallback } from 'react';
import { parseEventLogs } from 'viem';
import type { TransactionReceipt } from 'viem';
import {
  MAX_UINT256,
  SPLITTER_FACTORY_ABI,
  distributeAll,
  distributeForMany,
} from '@solarpunk/contracts';
import { useMarketplace } from '../context/MarketplaceContext';
import { useWallet } from '../context/WalletContext';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { useTxLifecycle } from './useTxLifecycle';
import type { TxLifecycle } from './useTxLifecycle';

/**
 * Count the clones the factory passed over. A clone that reverts is skipped rather than
 * propagated (SplitterFactory.sol:162-167), so a batch can half-succeed and the UI must say so.
 *
 * `writeContract` returns only a tx hash, so the `(swept, skipped)` return values are unreachable
 * that way — the receipt's `DistributeSkipped` logs are the accessible source.
 */
function skippedFrom(receipt: TransactionReceipt): number {
  return parseEventLogs({
    abi: SPLITTER_FACTORY_ABI,
    eventName: 'DistributeSkipped',
    logs: receipt.logs,
  }).length;
}

export function useDistributeAll(): TxLifecycle & {
  distributeAllFunded: () => Promise<void>;
} {
  const lifecycle = useTxLifecycle();
  const { client, refresh, fundedSplitters, stale, registry } = useMarketplace();
  const { requireWalletClient } = useWallet();

  const distributeAllFunded = useCallback(async () => {
    const tokens = erc20Currencies(config.currencies);

    // Prefer the explicit set: we already polled `pending` for every clone, so we know exactly
    // which hold a balance and need not pay to walk the idle ones. Fall back to the full registry
    // walk only when that data cannot be trusted.
    const useExplicitSet = !stale && fundedSplitters.length > 0;
    const attempted = useExplicitSet ? fundedSplitters.length : (registry?.sellers.length ?? 0);

    // Each ERC-20 is its own transaction — both batch helpers take a single token, not an array.
    // With USDC as the only ERC-20 in the currency config, this loop runs exactly once.
    for (const token of tokens) {
      const outcome = await lifecycle.run(
        async () => {
          const wallet = requireWalletClient();
          return useExplicitSet
            ? distributeForMany(wallet, config.factory, [...fundedSplitters], token.address)
            : distributeAll(wallet, config.factory, token.address, 0n, MAX_UINT256);
        },
        async (hash) => client.waitForTransactionReceipt({ hash }),
        (receipt) => {
          const skipped = skippedFrom(receipt);
          const swept = Math.max(attempted - skipped, 0);
          return skipped > 0
            ? `${token.symbol}: swept ${swept}, skipped ${skipped}`
            : `${token.symbol}: swept ${swept}`;
        },
      );

      // Stop the sequence on the first failure rather than prompting for the next signature.
      if (outcome.status === 'failed') break;
    }

    await refresh();
  }, [lifecycle, client, refresh, requireWalletClient, fundedSplitters, stale, registry]);

  return { ...lifecycle, distributeAllFunded };
}
