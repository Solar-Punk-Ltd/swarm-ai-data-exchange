import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fetchCatalogue } from './catalogue.js';
import { executeBuy } from './buyer.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.post('/api/buy', async (req, res) => {
  const { swarmHash, serverUrl } = req.body as { swarmHash?: string; serverUrl?: string };

  if (!swarmHash || !serverUrl) {
    res.status(400).json({ error: 'swarmHash and serverUrl are required' });
    return;
  }

  try {
    const result = await executeBuy(swarmHash, serverUrl);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`catalogue-feed-browser running at http://localhost:${PORT}`);
});
