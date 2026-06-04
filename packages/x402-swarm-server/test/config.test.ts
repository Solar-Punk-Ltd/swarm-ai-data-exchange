import { parseChainId, loadConfig } from '../src/config.js';

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
    PAYMENT_ADDRESS: '0xpay',
    PURCHASE_INTENT_DOMAIN_CONTRACT: '0xcontract',
    POSTAGE_BATCH_ID: 'f'.repeat(64),
    CATALOG_FEED_OWNER: '0xowner',
    ITEM_STATE_FEED_PK: '0xpk',
  };

  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    for (const k of Object.keys(REQUIRED)) delete process.env[k];
    delete process.env.NETWORK;
    delete process.env.PORT;
    delete process.env.DB_PATH;
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
    expect(cfg.paymentAddress).toBe('0xpay');
  });

  it('throws when a required variable is missing', () => {
    Object.assign(process.env, REQUIRED);
    delete process.env.CATALOG_FEED_OWNER;
    expect(() => loadConfig()).toThrow(/CATALOG_FEED_OWNER/);
  });
});
