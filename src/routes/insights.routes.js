// src/routes/insights.routes.js
// ----------------------------------------------------
import express from 'express';
import { exportUnknown, exportNotFound, exportUnknownTally, exportNotFoundTally, clearInsightsOlderThan } from '../services/insightsService.js';
import { buildProductIndex } from '../services/shopifyService.js';
import { suggestAll } from '../services/trainerService.js';
import { addDynamicSynonym, deleteDynamicSynonym, listDynamicSynonyms } from '../services/synonyms.js';
import { addIntentPhrase, deleteIntentPhrase, listIntentPhrases } from '../services/intentDynamicService.js';

export const insightsRouter = express.Router();

// Tallies simples (qué se repite más)
insightsRouter.get('/debug/insights/unknown/tally', async (_req, res) => {
  const tally = await exportUnknownTally(2000);
  res.json({ count: tally.length, tally });
});

insightsRouter.get('/debug/insights/notfound/tally', async (_req, res) => {
  const tally = await exportNotFoundTally(2000);
  res.json({ count: tally.length, tally });
});

// Sugerencias (intents + sinónimos/glosario)
insightsRouter.get('/debug/insights/suggestions', async (_req, res) => {
  const unknown = await exportUnknown(1000);
  const notfound = await exportNotFound(1000);
  const idx = await buildProductIndex();
  const suggestions = suggestAll({ unknown, notfound, productIndex: idx });
  res.json(suggestions);
});

// Limpiar históricos viejos
insightsRouter.post('/debug/insights/clear', async (req, res) => {
  const days = Number(req.query.olderThanDays || 30);
  const removed = await clearInsightsOlderThan(days);
  res.json({ ok: true, removed, olderThanDays: days });
});

// —— Admin: SINÓNIMOS dinámicos ——
insightsRouter.get('/debug/synonyms', async (_req, res) => {
  res.json({ map: await listDynamicSynonyms() });
});

insightsRouter.post('/debug/synonyms', async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from y to requeridos' });
  await addDynamicSynonym(from, to);
  res.json({ ok: true });
});

insightsRouter.delete('/debug/synonyms', async (req, res) => {
  const { from } = req.body || {};
  if (!from) return res.status(400).json({ error: 'from requerido' });
  await deleteDynamicSynonym(from);
  res.json({ ok: true });
});

// —— Admin: INTENTOS dinámicos ——
insightsRouter.get('/debug/intents', async (_req, res) => {
  res.json({ intents: listIntentPhrases() });
});

insightsRouter.post('/debug/intents', async (req, res) => {
  const { type, phrase } = req.body || {};
  if (!type || !phrase) return res.status(400).json({ error: 'type y phrase requeridos' });
  await addIntentPhrase(type, phrase);
  res.json({ ok: true });
});

insightsRouter.delete('/debug/intents', async (req, res) => {
  const { type, phrase } = req.body || {};
  if (!type || !phrase) return res.status(400).json({ error: 'type y phrase requeridos' });
  await deleteIntentPhrase(type, phrase);
  res.json({ ok: true });
});
