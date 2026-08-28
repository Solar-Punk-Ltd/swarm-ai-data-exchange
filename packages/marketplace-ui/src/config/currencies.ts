/**
 * Which balances the dashboard reads, per chain.
 *
 * `decimals` is load-bearing: USDC is 6 and ETH is 18, and formatting one with the other's
 * decimals is the classic silent bug here. Always format through viem's `formatUnits`.
 */
export interface Currency {
  symbol: string;
  decimals: number;
  /** Undefined for the chain's native currency; an ERC-20 address otherwise. */
  address?: `0x${string}`;
  /** Fixed places to render, so values do not jitter width on every poll. Defaults to 4. */
  displayDecimals?: number;
}

export const CURRENCIES: Record<number, Currency[]> = {
  84532: [
    { symbol: 'ETH', decimals: 18, displayDecimals: 4 },
    {
      symbol: 'USDC',
      decimals: 6,
      displayDecimals: 4,
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
  ],
  8453: [
    { symbol: 'ETH', decimals: 18, displayDecimals: 4 },
    {
      symbol: 'USDC',
      decimals: 6,
      displayDecimals: 4,
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  ],
};

/** The ERC-20 subset — the only currencies a splitter can hold or distribute. */
export function erc20Currencies(currencies: Currency[]): (Currency & { address: `0x${string}` })[] {
  return currencies.filter(
    (c): c is Currency & { address: `0x${string}` } => c.address !== undefined,
  );
}

/** Look up a currency by symbol for the configured chain. */
export function currencyBySymbol(currencies: Currency[], symbol: string): Currency | undefined {
  return currencies.find((c) => c.symbol === symbol);
}
