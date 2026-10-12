export interface GetSplitContractArgs {
  // Seller address whose splitter to read. Defaults to AGENT_PAYMENT_ADDRESS.
  seller?: string;
  // CAIP-2 chain to read (e.g. "eip155:11142220"). Defaults to the primary ERC8004_CHAIN.
  chainId?: string;
}
