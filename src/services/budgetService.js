// src/services/budgetService.js
// ----------------------------------------------------
// Orquesta: parsea texto, matchea catalogo, arma items, formatea mensaje.
// Inyecta fetchCandidates para tu BBDD (Sequelize/MySQL lo definis afuera).

import { parseOrderText } from './orderParser.js';
import { matchRequestedItems } from './catalogMatcher.js';
import { buildQuoteMessage } from './quoteFormatter.js';

export async function buildBudgetFromText(rawText, { fetchCandidates, cashDiscount=0.10 }){
  const requested = parseOrderText(rawText);

  const { matched, pending } = await matchRequestedItems(requested, fetchCandidates);

  const items = matched.map(({ requested: r, product: p }) => {
    const qty = r.quantity || 1;
    const unitPrice = Number(p.price || 0);
    const subtotal = unitPrice * qty;

    // shortName: intentamos conservar lo clave para no romper tabla
    const shortName = makeShortName(p.name, r);

    return {
      id: p.id,
      name: p.name,
      shortName,
      qty,
      unitName: p.unitName || 'UN',
      unitPrice,
      subtotal
    };
  });

  const msg = buildQuoteMessage({
    items,
    cashDiscount,
    title: '🧾 Presupuesto'
  });

  return { message: msg, items, pending };
}

function makeShortName(full='', r){
  const base = String(full);
  const picks = [];

  if (r.category) picks.push(r.category.toUpperCase());
  if (r.granulometry) picks.push(r.granulometry);
  if (r.dimensionStr) picks.push(r.dimensionStr);
  if (r.diameterMm) picks.push(`${r.diameterMm}MM`);
  if (r.volume && r.volume.value) picks.push(`${r.volume.value}M3`);
  if (r.sizeKg && r.sizeKg.value) picks.push(`${r.sizeKg.value}KG`);
  if (r.sizeLt && r.sizeLt.value) picks.push(`${r.sizeLt.value}L`);
  if (r.packaging) picks.push(r.packaging.toUpperCase());

  // Si no hay picks, devuelvo nombre original
  if (!picks.length) return base;

  // Intento construir "categoria + señales"
  const uniq = [...new Set(picks)];
  const sig = uniq.join(' ');
  // Si ya está contenido, devuelvo base, sino agrego al principio
  const low = base.toLowerCase();
  if (uniq.some(u => low.includes(u.toLowerCase()))) return base;
  return `${sig} — ${base}`;
}
