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
  // Celo Sepolia. CELO is the native token of the L2; USDC is Circle's native testnet deployment
  // (6 decimals, EIP-3009), the only asset Celo's x402 facilitator settles on this network.
  11142220: [
    { symbol: 'CELO', decimals: 18, displayDecimals: 4 },
    {
      symbol: 'USDC',
      decimals: 6,
      displayDecimals: 4,
      address: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    },
  ],
  // Celo mainnet.
  42220: [
    { symbol: 'CELO', decimals: 18, displayDecimals: 4 },
    {
      symbol: 'USDC',
      decimals: 6,
      displayDecimals: 4,
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
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
