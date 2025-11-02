// src/routes/index.js
import express from 'express';
import { watiRouter } from './wati.webhook.routes.js';
import { buildProductIndex } from '../services/shopifyService.js';
import { getSession } from '../services/sessionService.js';

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

routes.use('/webhook', watiRouter);
