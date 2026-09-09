import express from 'express';
import { Bee } from '@ethersphere/bee-js';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { FacilitatorClient } from './facilitator.js';
import { purchaseHandler } from './purchase.js';

const config = loadConfig();

const bee = new Bee(config.beeApiUrl);
const store = new Store(config.dbPath);
const facilitator = new FacilitatorClient(config.facilitatorUrl);

const app = express();
app.use(express.json());

app.post('/v1/items/:itemId/purchase', purchaseHandler({ bee, store, facilitator, config }));

app.listen(config.port, () => {
  console.log(`x402 Swarm server listening on port ${config.port}`);
  if (config.splitterAddress) {
    console.log(`Settlement destination pinned to split contract ${config.splitterAddress}`);
  } else {
    console.warn(
      'SPLITTER_ADDRESS is unset — any advertised payTo will be accepted. Sales settled to a ' +
        'non-split destination are untaxed and earn no Proof-of-Purchase.',
    );
  }
});
