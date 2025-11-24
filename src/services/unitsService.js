// src/services/unitsService.js
// ----------------------------------------------------
// Conversión básica de unidades y presentaciones por categoría.
// Soporta: m³, m2, kg, lt, u, bolsa, bolsón, 1/2 bolsón, etc.
// Heurísticas livianas por título/variant para no depender de metadatos.

import { computeLineTotals } from './priceService.js';

const UNIT_ALIASES = {
  'm3': ['m3', 'm³', 'metro cubico', 'metros cubicos', 'metro cúbico', 'metros cúbicos'],
  'm2': ['m2', 'm²', 'metro cuadrado', 'metros cuadrados'],
  'kg': ['kg', 'kilo', 'kilos'],
  'lt': ['lt', 'l', 'litro', 'litros'],
  'u': ['u', 'un', 'una', 'unidad', 'unid', 'unidades', 'bolsa', 'bolsas'],
  'bolson': ['bolson', 'bolsón', '1m3', '1 m3', 'bolson 1m3', 'bolsón 1m3'],
  'medio_bolson': ['medio bolson', '1/2m3', '0.5m3', 'medio bolsón', 'media m3', '1/2 m3'],
  'bolsita': ['bolsita', '3 baldes', '≈3 baldes', 'aprox 3 baldes'],
  'granel': ['granel', '6m3', '6 m3', 'camion', 'camión', 'volquete'],
};

function canonUnit(rawUnit = '') {
  const t = String(rawUnit || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  for (const [canon, arr] of Object.entries(UNIT_ALIASES)) {
    if (arr.some(a => t === a || t.includes(a))) return canon;
  }
  return null;
}

// Heurísticas por familia de producto (por título/variant)
function guessFamily(title = '') {
  const t = title.toLowerCase();
  if (/\barena\b|\bpiedra\b|\bescombro\b|\btosca\b/.test(t)) return 'áridos';
  if (/\bcemento\b|\bcal\b|plasticor|hidrofugo|hidrófugo|tacuru|poximix|sinteplast/.test(t)) return 'bolsa_quimico';
  if (/\bladrillo\b|telgopor|eps/.test(t)) return 'ladrillo';
  if (/\bmalla\b|hierro|fi\s*\d+|varilla|acero\b/.test(t)) return 'acero_malla';
  if (/\bceramic(o|os)|porcelanato|caja\b/.test(t)) return 'revestimiento';
  return 'generico';
}

// Conversiones expresadas a una unidad “base” por familia (cuando aplica)
const FAMILY_BASE = {
  'áridos': 'm3',               // bolsón ≈ 1 m3, medio_bolson ≈ 0.5 m3, granel ≈ 6 m3
  'bolsa_quimico': 'u',         // bolsa/unidad
  'ladrillo': 'u',
  'acero_malla': 'u',
  'revestimiento': 'm2',        // cajas expresan m2 en el título -> no convertimos sin dato exacto
  'generico': 'u'
};

export function convertQtyForProduct({ productTitle, variantTitle }, qty = 1, unitLike = null) {
  const family = guessFamily(`${productTitle} ${variantTitle || ''}`);
  const base = FAMILY_BASE[family] || 'u';
  const canon = unitLike ? canonUnit(unitLike) : null;

  // Defaults sin unitLike: intentamos inferir por variant
  const vt = `${variantTitle || ''}`.toLowerCase();

  // Áridos: presentaciones típicas
  if (family === 'áridos') {
    if (canon === 'medio_bolson' || /1\/2\s*m3|0\.?5\s*m3|medio/.test(vt)) return { qtyBase: 0.5 * qty, baseUnit: 'm3' };
    if (canon === 'bolsita' || /bolsita|3\s*baldes/.test(vt)) return { qtyBase: 0.15 * qty, baseUnit: 'm3' }; // ~heurística, ajustable
    if (canon === 'granel' || /6\s*m3|granel|camion|camión/.test(vt)) return { qtyBase: 6 * qty, baseUnit: 'm3' };
    // bolsón/1m3 por default
    return { qtyBase: 1 * qty, baseUnit: 'm3' };
  }

  // Revestimiento: si el título indica “(caja X m2)”
  if (family === 'revestimiento') {
    const m = vt.match(/caja\s*([0-9]+[.,]?[0-9]*)\s*m2/);
    if (m) return { qtyBase: qty * Number(m[1].replace(',', '.')), baseUnit: 'm2' };
    return { qtyBase: qty, baseUnit: 'm2' }; // fallback (mejor pedir confirmación al usuario)
  }

  // Bolsa/químicos: bolsa = unidad
  if (family === 'bolsa_quimico') {
    return { qtyBase: qty, baseUnit: 'u' };
  }

  // Ladrillo / acero / genérico: unidad
  return { qtyBase: qty, baseUnit: base };
}

// Helper para recalcular importes si cambia cantidad (usa precio unit estimado)
export function recalcLineAmounts(line, newQty) {
  const unit = (line?.amounts?.lista ?? 0) / Math.max(line?.qty || 1, 1);
  const totals = computeLineTotals({ price: unit }, Number(newQty));
  return { ...line, qty: Number(newQty), amounts: totals };
}
