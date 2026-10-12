import { parseChainId, parseChainMap, facilitatorUrlFor, loadConfig } from '../src/config.js';

describe('parseChainMap', () => {
  it('returns an empty map for unset or blank input', () => {
    expect(parseChainMap(undefined)).toEqual({});
    expect(parseChainMap('')).toEqual({});
    expect(parseChainMap(' , ')).toEqual({});
  });

  it('parses comma-separated key=value pairs, trimming whitespace', () => {
    expect(parseChainMap(' eip155:84532=0xabc , eip155:11142220=0xdef, ')).toEqual({
      'eip155:84532': '0xabc',
      'eip155:11142220': '0xdef',
    });
  });

  it('splits on the first "=" only, so URL keys and values with "=" survive', () => {
    expect(parseChainMap('https://api.x402.sepolia.celo.org=key==1')).toEqual({
      'https://api.x402.sepolia.celo.org': 'key==1',
    });
  });

  it('throws on an entry without a key or value', () => {
    expect(() => parseChainMap('eip155:84532', 'SPLITTER_ADDRESSES')).toThrow(/SPLITTER_ADDRESSES/);
    expect(() => parseChainMap('=0xabc')).toThrow(/expected <key>=<value>/);
    expect(() => parseChainMap('eip155:84532=')).toThrow(/expected <key>=<value>/);
  });
});

describe('facilitatorUrlFor', () => {
  const cfg = {
    facilitatorUrl: 'https://default.example',
    facilitatorUrls: { 'eip155:11142220': 'https://celo.example' },
  };
  it('prefers the per-rail override and falls back to the default', () => {
    expect(facilitatorUrlFor(cfg, 'eip155:11142220')).toBe('https://celo.example');
    expect(facilitatorUrlFor(cfg, 'eip155:84532')).toBe('https://default.example');
  });
});

describe('parseChainId', () => {
  it('extracts the numeric chain id from a CAIP-2 identifier', () => {
    expect(parseChainId('eip155:84532')).toBe(84532);
    expect(parseChainId('eip155:8453')).toBe(8453);
  });

  it('throws on a non-numeric chain segment', () => {
    expect(() => parseChainId('eip155:base')).toThrow(/Invalid CAIP-2/);
  });
});

describe('loadConfig', () => {
  const REQUIRED = {
    PURCHASE_INTENT_DOMAIN_CONTRACT: '0xcontract',
    POSTAGE_BATCH_ID: 'f'.repeat(64),
    CATALOG_FEED_OWNER: '0xowner',
    ITEM_STATE_FEED_PK: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    // The voucher server refuses to start without its Gnosis funder (Hardhat account #2 here).
    GIFT_FUNDER_PK: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  };

  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    for (const k of Object.keys(REQUIRED)) delete process.env[k];
    delete process.env.NETWORK;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.SPLITTER_ADDRESS;
    delete process.env.SPLITTER_ADDRESSES;
    delete process.env.FACILITATOR_URLS;
    delete process.env.FACILITATOR_API_KEYS;
    delete process.env.RPC_URLS;
  });
  afterEach(() => {
    process.env = saved;
  });

  it('applies defaults and derives chainId from NETWORK', () => {
    Object.assign(process.env, REQUIRED);
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.network).toBe('eip155:84532');
    expect(cfg.chainId).toBe(84532);
    expect(cfg.facilitatorUrl).toBe('https://x402.org/facilitator');
    expect(cfg.dbPath).toBe('./data/store.db');
    // Derived from ITEM_STATE_FEED_PK (Hardhat account #1).
    expect(cfg.itemStateFeedOwner).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
  });

  it('leaves every chain map empty when none is set', () => {
    Object.assign(process.env, REQUIRED);
    const cfg = loadConfig();
    expect(cfg.splitterAddresses).toEqual({});
    expect(cfg.facilitatorUrls).toEqual({});
    expect(cfg.facilitatorApiKeys).toEqual({});
    expect(cfg.rpcUrls).toEqual({});
  });

  it('maps the legacy single SPLITTER_ADDRESS onto NETWORK', () => {
    Object.assign(process.env, REQUIRED, { NETWORK: 'eip155:84532', SPLITTER_ADDRESS: '0xclone' });
    expect(loadConfig().splitterAddresses).toEqual({ 'eip155:84532': '0xclone' });
  });

  it('prefers SPLITTER_ADDRESSES over the legacy variable', () => {
    Object.assign(process.env, REQUIRED, {
      SPLITTER_ADDRESS: '0xlegacy',
      SPLITTER_ADDRESSES: 'eip155:84532=0xbase,eip155:11142220=0xcelo',
    });
    expect(loadConfig().splitterAddresses).toEqual({
      'eip155:84532': '0xbase',
      'eip155:11142220': '0xcelo',
    });
  });

  it('parses per-rail facilitator, API key and RPC maps', () => {
    Object.assign(process.env, REQUIRED, {
      FACILITATOR_URLS: 'eip155:11142220=https://api.x402.sepolia.celo.org',
      FACILITATOR_API_KEYS: 'https://api.x402.sepolia.celo.org=secret',
      RPC_URLS: 'eip155:11142220=https://forno.celo-sepolia.celo-testnet.org',
    });
    const cfg = loadConfig();
    expect(cfg.facilitatorUrls).toEqual({
      'eip155:11142220': 'https://api.x402.sepolia.celo.org',
    });
    expect(cfg.facilitatorApiKeys).toEqual({ 'https://api.x402.sepolia.celo.org': 'secret' });
    expect(cfg.rpcUrls).toEqual({
      'eip155:11142220': 'https://forno.celo-sepolia.celo-testnet.org',
    });
  });

  it('throws when a required variable is missing', () => {
    Object.assign(process.env, REQUIRED);
    delete process.env.CATALOG_FEED_OWNER;
    expect(() => loadConfig()).toThrow(/CATALOG_FEED_OWNER/);
  });
});
