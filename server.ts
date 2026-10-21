import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fetchRealHyperliquidMarketData } from './src/utils/marketDataFeed';

const app = express();
const PORT = 3000;

app.use(express.json());

/**
 * Endpoint telemetrii: ta sama implementacja co w przeglądarce (fetchRealHyperliquidMarketData),
 * z krótkim cache, aby wielu klientów nie mnożyło zapytań do Hyperliquid (limit wagowy per IP).
 */
const TELEMETRY_CACHE_MS = 2000;
let telemetryCache: { at: number; body: unknown } | null = null;

app.get('/api/quant/hyperliquid-live', async (_req, res) => {
  try {
    if (telemetryCache && Date.now() - telemetryCache.at < TELEMETRY_CACHE_MS) {
      res.json(telemetryCache.body);
      return;
    }
    const { liveTelemetry } = await fetchRealHyperliquidMarketData(300);
    if (!liveTelemetry) {
      res.status(502).json({ error: 'Hyperliquid API niedostępne lub niekompletne dane' });
      return;
    }
    telemetryCache = { at: Date.now(), body: liveTelemetry };
    res.json(liveTelemetry);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to compute server quant telemetry',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HyperQuant Full-Stack Analytical Desk server running on port ${PORT}`);
  });
}

startServer();
