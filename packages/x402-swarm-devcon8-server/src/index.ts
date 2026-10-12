import express from 'express';
import { Bee } from '@ethersphere/bee-js';
import { facilitatorUrlFor, loadConfig } from './config.js';
import { Store } from './db.js';
import { FacilitatorClient } from './facilitator.js';
import { purchaseHandler } from './purchase.js';
import { VoucherFunder } from './voucher.js';
import { CatalogCache } from './catalog.js';

const config = loadConfig();

const bee = new Bee(config.beeApiUrl);
const store = new Store(config.dbPath);
const funder = new VoucherFunder(config);
const catalog = new CatalogCache(
  bee,
  config.catalogFeedOwner,
  config.itemStateFeedOwner,
  config.catalogEntryTtlMs,
);

// One client per facilitator base URL, created on first use. A rail's facilitator can come from
// the catalog item itself, so the set is not fully known at boot.
const facilitators = new Map<string, FacilitatorClient>();
function facilitatorFor(url: string): FacilitatorClient {
  let client = facilitators.get(url);
  if (!client) {
    client = new FacilitatorClient(url, {
      apiKey: config.facilitatorApiKeys[url],
      rpcUrls: config.rpcUrls,
    });
    facilitators.set(url, client);
  }
  return client;
}

const app = express();
app.use(express.json());

app.post(
  '/v1/items/:itemId/purchase',
  purchaseHandler({ bee, store, facilitatorFor, config, funder, catalog }),
);

app.listen(config.port, () => {
  console.log(`x402 devcon8 voucher server listening on port ${config.port}`);
  console.log(
    `Voucher funding: ${config.giftXbzzAmount} xBZZ + ${config.giftXdaiAmount} xDAI per sale ` +
      `from ${funder.funderAddress} (chain ${config.giftChainId})`,
  );

  // The voucher is paid on the gift chain whichever rail the sale settled on.
  const rails = new Set<string>([
    config.network,
    ...Object.keys(config.splitterAddresses),
    ...Object.keys(config.facilitatorUrls),
  ]);
  for (const rail of rails) {
    const facilitator = facilitatorUrlFor(config, rail);
    const splitter = config.splitterAddresses[rail];
    console.log(
      `Rail ${rail}: facilitator ${facilitator}, split contract ${splitter ?? '(none)'}` +
        (config.facilitatorApiKeys[facilitator] ? ', API key set' : ''),
    );
    if (facilitator !== config.facilitatorUrl && !config.facilitatorApiKeys[facilitator]) {
      console.warn(
        `Rail ${rail}: no API key configured for ${facilitator}. Hosted facilitators such as ` +
          'Celo’s gate /settle on X-API-Key — set FACILITATOR_API_KEYS if this one does.',
      );
    }
  }

  if (Object.keys(config.splitterAddresses).length === 0) {
    console.warn(
      'SPLITTER_ADDRESSES is unset — any advertised payTo will be accepted. Sales settled to a ' +
        'non-split destination are untaxed and earn no Proof-of-Purchase.',
    );
  }
});
