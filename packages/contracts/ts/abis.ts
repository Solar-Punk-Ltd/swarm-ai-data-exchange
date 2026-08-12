// GENERATED FILE — regenerate with `pnpm --filter @solarpunk/contracts build:abis`.
//
// Checked in on purpose: downstream packages (swarm-market-mcp, x402-swarm-server) must be able
// to build without a Foundry toolchain installed. `ts/gen-abis.ts` rewrites this from the forge
// artifacts in `out/`; keep it in sync whenever the Solidity changes.

export const REVENUE_SPLITTER_ABI = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'BPS_DENOMINATOR',
    inputs: [],
    outputs: [{ name: '', type: 'uint16', internalType: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_TAX_BPS',
    inputs: [],
    outputs: [{ name: '', type: 'uint16', internalType: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'seller',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'treasury',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'taxBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint16', internalType: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      { name: 'seller_', type: 'address', internalType: 'address' },
      { name: 'treasury_', type: 'address', internalType: 'address' },
      { name: 'taxBps_', type: 'uint16', internalType: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pending',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [
      { name: 'sellerAmount', type: 'uint256', internalType: 'uint256' },
      { name: 'treasuryAmount', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'distribute',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'distributeMany',
    inputs: [{ name: 'tokens', type: 'address[]', internalType: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'SplitterInitialized',
    inputs: [
      { name: 'seller', type: 'address', indexed: true, internalType: 'address' },
      { name: 'treasury', type: 'address', indexed: true, internalType: 'address' },
      { name: 'taxBps', type: 'uint16', indexed: false, internalType: 'uint16' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Distributed',
    inputs: [
      { name: 'token', type: 'address', indexed: true, internalType: 'address' },
      { name: 'sellerAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'treasuryAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AlreadyInitialized', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  {
    type: 'error',
    name: 'TaxTooHigh',
    inputs: [
      { name: 'taxBps', type: 'uint16', internalType: 'uint16' },
      { name: 'maxTaxBps', type: 'uint16', internalType: 'uint16' },
    ],
  },
] as const;

export const SPLITTER_FACTORY_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: 'owner_', type: 'address', internalType: 'address' },
      { name: 'treasury_', type: 'address', internalType: 'address' },
      { name: 'defaultTaxBps_', type: 'uint16', internalType: 'uint16' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'treasury',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'defaultTaxBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint16', internalType: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'splitterOf',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'predictSplitter',
    inputs: [{ name: 'seller', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createSplitter',
    inputs: [{ name: 'seller', type: 'address', internalType: 'address' }],
    outputs: [{ name: 'splitter', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setTreasury',
    inputs: [{ name: 'treasury_', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDefaultTaxBps',
    inputs: [{ name: 'defaultTaxBps_', type: 'uint16', internalType: 'uint16' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renounceOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'SplitterCreated',
    inputs: [
      { name: 'seller', type: 'address', indexed: true, internalType: 'address' },
      { name: 'splitter', type: 'address', indexed: true, internalType: 'address' },
      { name: 'treasury', type: 'address', indexed: false, internalType: 'address' },
      { name: 'taxBps', type: 'uint16', indexed: false, internalType: 'uint16' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TreasuryUpdated',
    inputs: [
      { name: 'previousTreasury', type: 'address', indexed: true, internalType: 'address' },
      { name: 'newTreasury', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DefaultTaxBpsUpdated',
    inputs: [
      { name: 'previousTaxBps', type: 'uint16', indexed: false, internalType: 'uint16' },
      { name: 'newTaxBps', type: 'uint16', indexed: false, internalType: 'uint16' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  {
    type: 'error',
    name: 'TaxTooHigh',
    inputs: [
      { name: 'taxBps', type: 'uint16', internalType: 'uint16' },
      { name: 'maxTaxBps', type: 'uint16', internalType: 'uint16' },
    ],
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
  },
] as const;
