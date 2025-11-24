// src/routes/index.js
// ----------------------------------------------------
import express from 'express';
import { watiRouter } from './wati.webhook.routes.js';
import { buildProductIndex } from '../services/shopifyService.js';
import { getSession } from '../services/sessionService.js';
import { debug } from './debug.js';
import { exportUnknown, exportNotFound } from '../services/insightsService.js';
import { insightsRouter } from './insights.routes.js';

export const routes = express.Router();

routes.get('/health', (_req, res) => res.json({ ok: true }));

routes.get('/debug/products', async (_req, res) => {
  const idx = await buildProductIndex();
  res.json({ count: idx.length, sample: idx.slice(0, 3) });
});

routes.get('/debug/session/:phone', async (req, res) => {
  const s = await getSession(req.params.phone);
  res.json({ session: s });
});

// 👉 Insights legacy
routes.get('/debug/insights/unknown', async (_req, res) => {
  const rows = await exportUnknown(500);
  res.json({ count: rows.length, rows });
});
routes.get('/debug/insights/notfound', async (_req, res) => {
  const rows = await exportNotFound(500);
  res.json({ count: rows.length, rows });
});

// 👉 Nuevo router con tallies, sugerencias y admin
routes.use(insightsRouter);

routes.use(debug);           // preview/pdf
routes.use('/webhook', watiRouter);
