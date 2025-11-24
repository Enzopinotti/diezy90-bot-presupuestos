// src/controllers/watiWebhookController.js
// ----------------------------------------------------
// Webhook "simple" con mejoras:
// 1) Auto-start de Modo Presupuesto si el mensaje parece una lista de presupuesto
// 2) Silencio intencional ante "CATALOGO" para que WATI envíe su plantilla
// 3) Mantiene el flujo clásico con "PRESUPUESTO" y la edición dentro del modo

import { getSession } from '../services/sessionService.js';
import { sendText } from '../services/watiService.js';
import { startBudget, handleBudgetMessage } from './wati/budget.controller.js';
import { isLikelyBudgetList, splitLinesSmart } from '../services/textService.js';

export async function watiWebhookController(req, res) {
  const body  = req.body || {};
  const phone = body?.waId || body?.to || body?.from || 'unknown';
  const raw   = (body?.text || body?.message || '').toString().trim();

  req.log?.info({
    phone,
    eventType: body?.eventType,
    status: body?.statusString,
    text: raw
  }, 'WATI inbound');

  // ACK inmediato
  res.status(200).json({ ok: true });
  if (!phone || phone === 'unknown') return;

  // Normalizado básico
  const T = raw
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}# ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // Silencio para tags internos (#algo)
  if (T.startsWith('#')) return;

  // 👉 Si el usuario pide CATALOGO, dejamos que WATI dispare su plantilla
  if (T === 'CATALOGO' || T === 'CATALOGO.' || T === 'VER CATALOGO' || T === 'VER CATALOGO.') {
    return; // no respondemos nada
  }

  // Activar modo presupuesto explícito
  if (T === 'PRESUPUESTO' || T === 'PRESUPUESTOS') {
    await startBudget({ phone }); // startBudget ya manda el mensaje largo
    return;
  }

  // Si ya está en presupuesto, delegamos el manejo
  const sess = await getSession(phone);
  if (sess?.mode === 'BUDGET') {
    await handleBudgetMessage(req, body, phone);
    return;
  }

  // 🔎 Auto-start: si el texto "huele" a lista de presupuesto (múltiples líneas, items, cantidades)
  if (isLikelyBudgetList(raw)) {
    await startBudget({ phone, silent: true });
    const lines = splitLinesSmart(raw).join('\n'); // normalizamos saltos antes de parsear
    await handleBudgetMessage(req, { text: lines }, phone);
    return;
  }

  // Fuera de presupuesto y sin lista: silencio (dejamos a WATI manejar saludos/plantillas)
  return;
}
