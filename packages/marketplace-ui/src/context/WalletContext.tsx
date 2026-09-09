/**
 * Minimal EIP-1193 wallet binding.
 *
 * Deliberately not wagmi/RainbowKit: this package has two write paths and no session state to
 * manage, so the dependency weight is not worth it.
 *
 * Reads work with no wallet connected at all — connection is required only to distribute.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createWalletClient, custom, getAddress, numberToHex } from 'viem';
import type { Account, Address, Chain, WalletClient } from 'viem';
import { config } from '../config/env';
import { isUserRejection, walletErrorMessage } from '../lib/rpcError';

/** What the @solarpunk/contracts write helpers require. */
export type ReadyWalletClient = WalletClient & { account: Account; chain: Chain };

export interface WalletState {
  /** No injected provider at all — show an install hint rather than a dead button. */
  available: boolean;
  account?: Address;
  chainId?: number;
  connecting: boolean;
  error?: string;
  /** Connected, but on the wrong network. A first-class state, not a failed send. */
  wrongChain: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  /** Throws unless connected on the configured chain. Callers gate on `wrongChain`/`account`. */
  requireWalletClient: () => ReadyWalletClient;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  // Pick up an already-authorized account on load without prompting.
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;

    void (async () => {
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
        const current = (await provider.request({ method: 'eth_chainId' })) as string;
        if (cancelled) return;
        if (accounts.length > 0) setAccount(getAddress(accounts[0]));
        setChainId(Number(current));
      } catch {
        // An unreachable provider is not an error worth surfacing until the user clicks Connect.
      }
    })();

    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAccount(list.length > 0 ? getAddress(list[0]) : undefined);
    };
    const onChain = (next: unknown) => setChainId(Number(next as string));

    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      cancelled = true;
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('chainChanged', onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setConnecting(true);
    setError(undefined);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const current = (await provider.request({ method: 'eth_chainId' })) as string;
      setAccount(accounts.length > 0 ? getAddress(accounts[0]) : undefined);
      setChainId(Number(current));
    } catch (err) {
      // Dismissing the wallet prompt is a decision, not a failure: leave the button exactly as it
      // was rather than reporting an error the user already knows about.
      setError(isUserRejection(err) ? undefined : walletErrorMessage(err));
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    setError(undefined);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: numberToHex(config.chain.id) }],
      });
    } catch (err) {
      setError(isUserRejection(err) ? undefined : walletErrorMessage(err));
    }
  }, [provider]);

  const wrongChain = account !== undefined && chainId !== undefined && chainId !== config.chain.id;

  const requireWalletClient = useCallback((): ReadyWalletClient => {
    if (!provider) throw new Error('No wallet provider found.');
    if (!account) throw new Error('Wallet is not connected.');
    if (chainId !== config.chain.id) {
      throw new Error(`Wallet is on chain ${chainId}; switch to ${config.chain.name}.`);
    }
    return createWalletClient({
      account,
      chain: config.chain,
      transport: custom(provider),
    }) as ReadyWalletClient;
  }, [provider, account, chainId]);

  const value = useMemo<WalletState>(
    () => ({
      available: provider !== undefined,
      account,
      chainId,
      connecting,
      error,
      wrongChain,
      connect,
      switchChain,
      requireWalletClient,
    }),
    [
      provider,
      account,
      chainId,
      connecting,
      error,
      wrongChain,
      connect,
      switchChain,
      requireWalletClient,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
