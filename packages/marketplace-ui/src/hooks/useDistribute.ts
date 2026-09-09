import { useCallback } from 'react';
import type { Address } from 'viem';
import { distributeMany } from '@solarpunk/contracts';
import { useMarketplace } from '../context/MarketplaceContext';
import { useWallet } from '../context/WalletContext';
import { config } from '../config/env';
import { erc20Currencies } from '../config/currencies';
import { useTxLifecycle } from './useTxLifecycle';
import type { TxLifecycle } from './useTxLifecycle';

/**
 * Sweep one clone.
 *
 * ERC-20 only: `RevenueSplitter` has no `receive()`, so a clone cannot hold ETH and
 * `distributeMany` has no native sentinel. Native currency entries are filtered out.
 *
 * Gas is paid by the connected wallet — on this dashboard, the marketplace operator. `distribute`
 * is permissionless precisely so a seller never has to hold gas to receive their revenue.
 */
export function useDistribute(
  splitter: Address,
): TxLifecycle & { distribute: () => Promise<void> } {
  const lifecycle = useTxLifecycle();
  const { client, refresh } = useMarketplace();
  const { requireWalletClient } = useWallet();

  const distribute = useCallback(async () => {
    const tokens = erc20Currencies(config.currencies).map((c) => c.address);

    await lifecycle.run(
      async () => distributeMany(requireWalletClient(), splitter, tokens),
      async (hash) => client.waitForTransactionReceipt({ hash }),
    );

    // Confirmed or not, re-read: a revert still means the on-screen numbers are worth rechecking.
    await refresh();
  }, [lifecycle, client, refresh, requireWalletClient, splitter]);

  return { ...lifecycle, distribute };
}
