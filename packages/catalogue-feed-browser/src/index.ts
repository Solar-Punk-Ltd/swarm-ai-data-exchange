import 'dotenv/config';
import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { Bee } from '@ethersphere/bee-js';
import { fetchCatalogue } from './catalogue.js';
import { readCatalogMeta } from './reader.js';
import { executeBuy } from './buyer.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633';

const app = express();
app.use(express.json());
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  }),
);

app.get('/api/config', (_req, res) => {
  res.json({
    defaultFeedOwner: process.env.DEFAULT_FEED_OWNER ?? '',
    defaultFeedTopic: process.env.DEFAULT_FEED_TOPIC ?? '',
    defaultServerUrl: process.env.DEFAULT_SERVER_URL ?? 'http://localhost:3000',
  });
});

app.get('/api/catalogue', async (req, res) => {
  const feedOwner = String(req.query.feedOwner ?? '');
  const feedTopic = String(req.query.feedTopic ?? '');
  const beeUrl = String(req.query.beeUrl ?? BEE_API_URL);

  if (!feedOwner || !feedTopic) {
    res.status(400).json({ error: 'feedOwner and feedTopic are required' });
    return;
  }

  try {
    const catalogue = await fetchCatalogue(beeUrl, feedTopic, feedOwner);
    res.json(catalogue);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Collection-level metadata (name/description/license) from /catalog.jsonld, resolved via the
// v1 Mantaray catalog. Topic is the fixed CATALOG_FEED_TOPIC, so only the owner is needed.
// 404s (not 500) when the catalog or its catalog.jsonld is absent — the UI treats it as optional.
app.get('/api/catalog/:owner/meta', async (req, res) => {
  const owner = String(req.params.owner ?? '');
  const beeUrl = String(req.query.beeUrl ?? BEE_API_URL);

  if (!owner) {
    res.status(400).json({ error: 'owner is required' });
    return;
  }

  try {
    const bee = new Bee(beeUrl);
    const meta = await readCatalogMeta(bee, owner);
    res.json(meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

app.post('/api/buy', async (req, res) => {
  const { swarmHash, serverUrl } = req.body as { swarmHash?: string; serverUrl?: string };

  if (!swarmHash || !serverUrl) {
    res.status(400).json({ error: 'swarmHash and serverUrl are required' });
    return;
  }

  try {
    const result = await executeBuy(swarmHash, serverUrl, BEE_API_URL);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/download', async (req, res) => {
  const swarmHash = String(req.query.swarmHash ?? '');
  const actHistoryAddress = String(req.query.actHistoryAddress ?? '');
  const publisherPublickey = String(req.query.publisherPublickey ?? '');

  if (!swarmHash || !actHistoryAddress || !publisherPublickey) {
    res
      .status(400)
      .json({ error: 'swarmHash, actHistoryAddress, and publisherPublickey are required' });
    return;
  }

  try {
    const beeRes = await fetch(`${BEE_API_URL}/bzz/${swarmHash}/`, {
      headers: {
        'swarm-act': 'true',
        'swarm-act-publisher': publisherPublickey,
        'swarm-act-history-address': actHistoryAddress,
      },
    });

    if (!beeRes.ok) {
      const text = await beeRes.text();
      res.status(beeRes.status).json({ error: `Bee error ${beeRes.status}: ${text}` });
      return;
    }

    res.setHeader('Content-Type', beeRes.headers.get('content-type') ?? 'application/octet-stream');
    const disposition = beeRes.headers.get('content-disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);

    if (beeRes.body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(beeRes.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`catalogue-feed-browser running at http://localhost:${PORT}`);
});
