import 'dotenv/config';
import express from 'express';
import path from 'path';
import { Bee } from '@ethersphere/bee-js';
import { privateKeyToAccount } from 'viem/accounts';
import { listItems, getItem, getSample, readCatalogMeta } from './reader.js';
import { purchase } from './buyer.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633';

const bee = new Bee(BEE_API_URL);
const app = express();
app.use(express.json());
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  }),
);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The consumer's Bee-node public key is the ACT grantee identity (added to the grantee list).
async function getBeePublicKey(beeUrl: string): Promise<string> {
  const res = await fetch(`${beeUrl}/addresses`);
  if (!res.ok) throw new Error(`Failed to fetch Bee addresses (${res.status})`);
  const data = (await res.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error('Bee /addresses response missing publicKey');
  return data.publicKey.startsWith('0x') ? data.publicKey : `0x${data.publicKey}`;
}

app.get('/api/config', (_req, res) => {
  res.json({
    defaultFeedOwner: process.env.DEFAULT_FEED_OWNER ?? '',
    defaultPublisherUrl: process.env.DEFAULT_PUBLISHER_URL ?? 'http://localhost:3000',
  });
});

// Collection-level metadata (name/description/license) from /catalog.jsonld. 404s (not 500)
// when absent — the UI treats the header as optional.
app.get('/api/catalog/:owner/meta', async (req, res) => {
  try {
    res.json(await readCatalogMeta(bee, req.params.owner));
  } catch (err) {
    res.status(404).json({ error: errMessage(err) });
  }
});

// List view (§13.2).
app.get('/api/catalog/:owner/items', async (req, res) => {
  try {
    res.json(await listItems(req.params.owner, bee));
  } catch (err) {
    res.status(500).json({ error: errMessage(err) });
  }
});

// Detail view (§13.2) — full item.jsonld.
app.get('/api/catalog/:owner/items/:itemId', async (req, res) => {
  try {
    res.json(await getItem(req.params.owner, req.params.itemId, bee));
  } catch (err) {
    res.status(404).json({ error: errMessage(err) });
  }
});

// Sample proxy (§13.3) — open-access preview bytes with the declared Content-Type.
app.get('/api/catalog/:owner/items/:itemId/sample', async (req, res) => {
  try {
    const { data, encodingFormat } = await getSample(req.params.owner, req.params.itemId, bee);
    res.setHeader('Content-Type', encodingFormat);
    res.setHeader('X-Swarm-Sample', 'true');
    res.send(Buffer.from(data));
  } catch (err) {
    res.status(404).json({ error: errMessage(err) });
  }
});

// Trigger the consumer purchase flow (§10.1 / §11.4).
app.post('/api/purchase', async (req, res) => {
  const { publisherUrl, itemId } = req.body as { publisherUrl?: string; itemId?: string };
  if (!publisherUrl || !itemId) {
    res.status(400).json({ error: 'publisherUrl and itemId are required' });
    return;
  }

  try {
    let pk = process.env.EVM_PRIVATE_KEY;
    if (!pk) throw new Error('EVM_PRIVATE_KEY environment variable is required');
    if (!pk.startsWith('0x')) pk = `0x${pk}`;

    const walletSigner = privateKeyToAccount(pk as `0x${string}`);
    const granteePublicKey = await getBeePublicKey(BEE_API_URL);
    const publisherEndpoint = `${publisherUrl.replace(/\/$/, '')}/v1/items/${itemId}/purchase`;

    const result = await purchase({ publisherEndpoint, itemId, granteePublicKey, walletSigner });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errMessage(err) });
  }
});

app.listen(PORT, () => {
  console.log(`catalogue-feed-browser running at http://localhost:${PORT}`);
});
