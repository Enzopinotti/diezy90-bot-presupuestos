// src/services/contextService.js
// ----------------------------------------------------
import { recalcLineAmounts } from './unitsService.js';

const ORD_MAP = {
  'primero':1, 'primera':1,
  'segundo':2, 'segunda':2,
  'tercero':3, 'tercera':3,
  'cuarto':4, 'cuarta':4,
  'quinto':5, 'quinta':5,
  'sexto':6, 'sexta':6,
  'septimo':7, 'séptimo':7, 'septima':7, 'séptima':7,
  'octavo':8, 'octava':8,
  'noveno':9, 'novena':9,
  'decimo':10, 'décimo':10, 'decima':10, 'décima':10
};

export function trackLastAction(sess, { index = null, productId = null, variantId = null } = {}) {
  sess.lastAction = { at: Date.now(), index, productId, variantId };
  return sess;
}

export function resolveTargetRef(rawText, items = [], lastAction = null) {
  const t = String(rawText || '').toLowerCase();

  // número explícito
  let m = t.match(/\b(\d+)\b/);
  if (m) {
    const i = Number(m[1]) - 1;
    return (i >= 0 && i < items.length) ? i : null;
  }

  // ordinales
  for (const [w, n] of Object.entries(ORD_MAP)) {
    if (t.includes(w)) return items[n - 1] ? (n - 1) : null;
  }

  // penúltimo / último
  if (/\bpenultim[oa]\b/.test(t)) {
    if (items.length >= 2) return items.length - 2;
  }
  if (/\b(ultimo|último)\b/.test(t)) {
    if (items.length) return items.length - 1;
  }

  // anáforas
  if (/\b(ese|eso|el mismo|lo mismo|el anterior)\b/.test(t)) {
    if (lastAction?.index != null && items[lastAction.index]) return lastAction.index;
  }

  return null;
}

// op: ADD/SUB/DOUBLE/HALF
export function applyRelativeAdjust(sess, { targetIndex, op, qty = null }) {
  if (targetIndex == null || !sess.items?.[targetIndex]) return { changed: false, message: 'Ítem no encontrado.' };
  const it = sess.items[targetIndex];

  let newQty = it.qty;
  if (op === 'ADD') newQty = it.qty + Math.max(1, Number(qty || 1));
  if (op === 'SUB') newQty = Math.max(0, it.qty - Math.max(1, Number(qty || 1)));
  if (op === 'DOUBLE') newQty = it.qty * 2;
  if (op === 'HALF') newQty = Math.max(1, Math.round(it.qty / 2));

  if (newQty === 0) {
    // Eliminar línea si quedó en 0
    sess.items.splice(targetIndex, 1);
    trackLastAction(sess, { index: Math.min(targetIndex, sess.items.length - 1) });
    return { changed: true, item: null };
  }

  const updated = recalcLineAmounts(it, newQty);
  sess.items[targetIndex] = updated;
  trackLastAction(sess, { index: targetIndex, productId: it.productId, variantId: it.variantId });

  return { changed: true, item: updated };
}
