// src/services/matchService.js
// ----------------------------------------------------
// Matching centralizado para líneas de presupuesto (texto → producto Shopify).
// - Usa primero un match directo "fuerte" contra títulos Shopify.
// - Luego el glosario D90 (palabras clave limpias).
// - Si no matchea nada en glosario, fallback a Shopify directo.
// - Si hay ambigüedad → devuelve clarify con precios.
// - Si no encuentra nada → notFound



import glossary from '../data/glossary.json' with { type: 'json' };
import { normalizeTerms } from './synonyms.js';

/* ----------------------------------------------
 * Normalización base tolerante
 * ------------------------------------------- */
function baseNorm(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s/.,-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ----------------------------------------------
 * Tokenizar + singularizar liviano
 * ------------------------------------------- */
function tokenize(str = '') {
  const t = baseNorm(str);
  if (!t) return [];
  return t.split(/\s+/).map(w => {
    if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
    return w;
  });
}



/* ----------------------------------------------
 * Score estilo Jaccard entre tokens
 * ------------------------------------------- */
function tokenScore(aTokens = [], bTokens = []) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  if (!union) return 0;
  return inter / union;

}

/* ----------------------------------------------
 * Humanización de nombres (1M3 → 1 m³, bolsita, etc.)
 * ------------------------------------------- */
export function humanizeName(name = '') {
  let out = String(name || '');

  // m3 genérico
  out = out.replace(/\b(\d+)\s*m3\b/gi, (_, n) => `${n} m³`);
  out = out.replace(/\b(1\/2)\s*m3\b/gi, '½ m³');
  out = out.replace(/\b1\/2m3\b/gi, '½ m³');
  out = out.replace(/\b6m3\b/gi, '6 m³');

  // Bolsitas / baldes
  // Si ya dice ARENA BOLSITA no repetimos "bolsita"
  out = out.replace(/\bARENA\s+BOLSITA\b\s*> ?3 baldes/gi, 'ARENA bolsita (>3 baldes)');
  out = out.replace(/> ?3 baldes/gi, 'bolsita (>3 baldes)');
  out = out.replace(/x ?3 baldes/gi, 'bolsita (3 baldes)');

  // Tildes faltantes comunes
  out = out.replace(/\bbolson\b/gi, 'bolsón');

  return out.replace(/\s+/g, ' ').trim();
}

function formatPriceARS(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* ----------------------------------------------
 * MATCH CONTRA GLOSARIO
 * ------------------------------------------- */
function matchGlossary(lineText) {
  const normLine = baseNorm(lineText);
  const lineTokens = tokenize(normLine);

  let bestScore = 0;
  const scored = [];

  for (const item of glossary) {
    const variants = [item.keyword, ...(item.aliases || [])];
    let itemBest = 0;

    for (const v of variants) {
      const vt = tokenize(v);
      const sc = tokenScore(lineTokens, vt);
      if (sc > itemBest) itemBest = sc;
    }

    if (itemBest > 0) {
      scored.push({ item, score: itemBest });
      if (itemBest > bestScore) bestScore = itemBest;
    }
  }

  const MIN_SCORE = 0.32;
  if (!scored.length || bestScore < MIN_SCORE) {
    return { type: 'none', match: null };
  }

  const EPS = 0.05;
  const bestGroup = scored.filter(s => bestScore - s.score <= EPS);

  if (bestGroup.length === 1) {
    return { type: 'single', match: bestGroup[0].item };
  }

  return {
    type: 'ambiguous',
    candidates: bestGroup.map(s => s.item),
  };
}

/* ----------------------------------------------
 * SHOPIFY: buscar productos por keyword glosario
 * ------------------------------------------- */
function findProductsForKeyword(keyword, productIndex = []) {
  const kwTokens = tokenize(keyword);
  const strongTokens = extractStrongTokens(kwTokens);

  const results = [];

  for (const p of productIndex || []) {
    const title = String(p.title || '');
    const tTokens = tokenize(title);

    // Filtro duro: todos los tokens fuertes deben estar en el título
    if (!passesStrongTokenFilter(strongTokens, tTokens)) continue;

    const tNorm = baseNorm(title);
    const kw = baseNorm(keyword);

    let score = tokenScore(kwTokens, tTokens);
    const strongSub = tNorm.includes(kw) || kw.includes(tNorm);
    if (strongSub) score = Math.max(score, 0.50);

    if (score >= 0.35) {
      results.push({ product: p, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ----------------------------------------------
 * MATCH DIRECTO contra Shopify (fallback)
 * ------------------------------------------- */
function directProductMatch(cleanText, productIndex = []) {
  const normLine = baseNorm(cleanText);
  const lineTokens = tokenize(normLine);
  const strongTokens = extractStrongTokens(lineTokens);

  const scored = [];

  for (const p of productIndex || []) {
    const title = String(p.title || '');
    const tTokens = tokenize(title);

    // Filtro duro
    if (!passesStrongTokenFilter(strongTokens, tTokens)) continue;

    const tNorm = baseNorm(title);

    let score = tokenScore(lineTokens, tTokens);
    if (tNorm.includes(normLine) || normLine.includes(tNorm)) {
      score = Math.max(score, 0.5);
    }

    if (score > 0) scored.push({ product: p, score });
  }

  if (!scored.length) return { type: 'none', products: [] };

  scored.sort((a, b) => b.score - a.score);
  const bestScore = scored[0].score;

  if (bestScore < 0.32) return { type: 'none', products: [] };

  const EPS = 0.08;
  const bestGroup = scored.filter(s => bestScore - s.score <= EPS);

  if (bestGroup.length === 1) {
    return { type: 'single', products: [bestGroup[0].product] };
  }

  return { type: 'ambiguous', products: bestGroup.map(s => s.product) };
}

/* ----------------------------------------------
 * MATCH MUY FUERTE antes del glosario
 * ------------------------------------------- */
function directProductStrong(cleanText, productIndex = []) {
  const normLine = baseNorm(cleanText);
  const lineTokens = tokenize(normLine);
  const strongTokens = extractStrongTokens(lineTokens);

  const scored = [];

  for (const p of productIndex || []) {
    const title = String(p.title || '');
    const tTokens = tokenize(title);

    // Filtro duro
    if (!passesStrongTokenFilter(strongTokens, tTokens)) continue;

    const tNorm = baseNorm(title);

    let score = tokenScore(lineTokens, tTokens);

    if (tNorm.includes(normLine) || normLine.includes(tNorm)) {
      score = Math.max(score, 0.9);
    }

    if (score > 0) scored.push({ product: p, score });
  }

  if (!scored.length) return { type: 'none', products: [] };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];

  if (best.score >= 0.85 && (!second || best.score - second.score >= 0.25)) {
    return { type: 'single', products: [best.product] };
  }

  return { type: 'none', products: [] };
}

/* ----------------------------------------------
 * Construcción de mensaje ask (desambiguación)
 * ------------------------------------------- */
function buildClarify(lineText, products = [], qty = 1, priceMap = {}) {
  // Mostrar TODAS las opciones disponibles (sin límite de 6)
  const opts = products.map((p, i) => {
    const v = (p.variants || [])[0] || {};
    const rawPrice = priceMap[p.id] ?? Number(v.price ?? NaN);
    const price = Number.isFinite(rawPrice) ? rawPrice : null;

    const label = `${i + 1}) ${humanizeName(p.title)}`;

    return {
      label,
      productId: p.id,
      variantId: v.id || null,
      fullTitle: humanizeName(
        `${p.title} ${v.title && v.title !== 'Default Title' ? v.title : ''}`.trim()
      ),
      price
    };
  });

  const questionLines = opts.map((o, i) => {
    const priceStr = o.price != null ? `\n   $ ${formatPriceARS(o.price)}` : '';
    // Formato más profesional:
    // 1. Nombre del Producto
    //    $ 10.500
    return `${i + 1}. *${o.label.split(') ')[1]}*${priceStr}`;
  });

  // Limpiar término de búsqueda para mostrar (quitar "de ", "del ")
  const cleanTerm = lineText.replace(/^(de|del|el|la|los|las)\s+/i, '');
  const qtyPrefix = qty > 1 ? `${qty} ` : '';

  return {
    question:
      `🔎 Con *"${qtyPrefix}${cleanTerm}"* encontré estas opciones:\n\n` +
      questionLines.join('\n\n') +
      `\n\n👇 Respondé con el número de la opción correcta`,
    options: opts,
    qty
  };
}

/* ----------------------------------------------
 * Detectar términos genéricos que requieren desambiguación
 * ------------------------------------------- */
function isGenericTerm(text) {
  const normalized = baseNorm(text);
  const tokens = tokenize(normalized);

  // Términos genéricos comunes en construcción
  const GENERIC_TERMS = [
    'arena', 'cemento', 'piedra', 'cal', 'ladrillo',
    'hierro', 'malla', 'ceramico', 'hidrofugo',
    'escombro', 'tosca', 'plasticor',
    'vigueta', 'alambre', 'clavo', 'tornillo',
    'aislante', 'tapa', 'pallet'
  ];

  // Si el texto normalizado es solo un término genérico (o con cantidad)
  // Ejemplo: "arena", "arena x3", "cemento", "piedra bolson"
  const hasGeneric = GENERIC_TERMS.some(term => tokens.includes(term));

  // Es genérico si:
  // 1. Contiene un término genérico
  // 2. Y tiene 3 tokens o menos (excluyendo números y "x")
  const meaningfulTokens = tokens.filter(t =>
    !/^\d+$/.test(t) && t !== 'x' && t !== 'por' && t !== 'a'
  );

  return hasGeneric && meaningfulTokens.length <= 3;
}

/* ----------------------------------------------
 * Tokens fuertes (filtrado duro de opciones)
 * ------------------------------------------- */
function extractStrongTokens(tokens = []) {
  const STOP = new Set(['x', 'por', 'a', 'm3', 'm', 'mm', 'kg', 'bolson', 'bolsita', 'de', 'del', 'el', 'la', 'los', 'las']);
  return tokens.filter(t => {
    // 1. Números son SIEMPRE fuertes (ej: 12, 8, 18, 50)
    if (/^\d+$/.test(t)) return true;

    // 2. Palabras largas (>= 4 letras) que no sean stopwords
    return t.length >= 4 && !STOP.has(t);
  });
}

function passesStrongTokenFilter(strongTokens = [], titleTokens = []) {
  if (!strongTokens.length) return true; // nada fuerte → no filtro
  const set = new Set(titleTokens);
  for (const st of strongTokens) {
    if (!set.has(st)) return false;
  }
  return true;
}

/* ----------------------------------------------
 * Buscar productos por categoría genérica
 * ------------------------------------------- */
function findProductsByGenericTerm(text, productIndex = []) {
  const normalized = baseNorm(text);
  const tokens = tokenize(normalized);

  // Extraer el término genérico principal (misma lista que isGenericTerm)
  const GENERIC_TERMS = [
    'arena', 'cemento', 'piedra', 'cal', 'ladrillo',
    'hierro', 'malla', 'ceramico', 'hidrofugo',
    'escombro', 'tosca', 'plasticor',
    'vigueta', 'alambre', 'clavo', 'tornillo',
    'aislante', 'tapa', 'pallet'
  ];

  const mainTerm = GENERIC_TERMS.find(term => tokens.includes(term));
  if (!mainTerm) return [];

  // Si buscan cemento, también buscar plasticor (marca común)
  const termsToSearch = [mainTerm];
  if (mainTerm === 'cemento') {
    termsToSearch.push('plasticor');
  }

  // Detectar números explícitos en la búsqueda (ej: "12", "8", "18")
  const queryNumbers = tokens.filter(t => /^\d+$/.test(t));

  // Buscar todos los productos que contengan el término o sus variantes
  const results = [];

  for (const p of productIndex || []) {
    const title = baseNorm(p.title || '');
    const titleTokens = tokenize(title);

    // El producto debe contener alguno de los términos de búsqueda
    const containsSearchTerm = termsToSearch.some(term => titleTokens.includes(term));
    if (!containsSearchTerm) continue;

    // FILTRO ESTRICTO DE NÚMEROS:
    // Si la búsqueda tiene números (ej: "ladrillo del 12"), el producto DEBE tenerlos.
    if (queryNumbers.length > 0) {
      const allNumbersPresent = queryNumbers.every(qn => titleTokens.includes(qn));
      if (!allNumbersPresent) continue;
    }

    // Calcular score basado en coincidencias adicionales
    let score = 0.5; // Score base por contener el término

    // Bonus por tokens adicionales que coincidan
    for (const t of tokens) {
      if (!termsToSearch.includes(t) && titleTokens.includes(t)) {
        score += 0.15;
      }
    }

    results.push({ product: p, score });
  }

  // Ordenar por score y retornar TODOS (sin límite)
  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ----------------------------------------------
 * smartMatch (Principal)
 * ------------------------------------------- */
export async function smartMatch(text, productIndex, qty = 1, priceMap = {}) {
  const accepted = [];
  const clarify = [];
  const notFound = [];

  const requestedQty = Number(qty || 1) || 1;

  // 0) Corrección ortográfica para errores comunes
  const { correctSpelling } = await import('./spellingCorrector.js');
  const corrected = correctSpelling(text || '');

  // Texto limpio sin cantidad
  const normalized = normalizeTerms(corrected);
  const coreForGlossary = normalized.replace(/\b(?:x|por|a)\s*\d+(?:[.,]\d+)?\b/gi, ' ').trim();

  // 0) Detectar términos genéricos y forzar desambiguación
  if (isGenericTerm(coreForGlossary || normalized)) {
    const genericResults = findProductsByGenericTerm(coreForGlossary || normalized, productIndex);

    if (!genericResults.length) {
      notFound.push(text);
      return { accepted, clarify, notFound };
    }

    // Siempre desambiguar para términos genéricos
    clarify.push(buildClarify(text, genericResults.map(r => r.product), requestedQty, priceMap));
    return { accepted, clarify, notFound };
  }

  // 1) Match fuerte directo
  const strong = directProductStrong(coreForGlossary || normalized, productIndex);
  if (strong.type === 'single') {
    const p = strong.products[0];
    accepted.push({
      product: p,
      variant: (p.variants || [])[0] || {},
      qty: requestedQty
    });
    return { accepted, clarify, notFound };
  }

  // 2) Glosario
  const gMatch = matchGlossary(coreForGlossary);

  if (gMatch.type === 'single') {
    const item = gMatch.match;
    const prods = findProductsForKeyword(item.keyword, productIndex);

    if (!prods.length) {
      notFound.push(text);
      return { accepted, clarify, notFound };
    }

    if (prods.length === 1) {
      const p = prods[0].product;
      accepted.push({
        product: p,
        variant: (p.variants || [])[0] || {},
        qty: requestedQty
      });
      return { accepted, clarify, notFound };
    }

    clarify.push(buildClarify(text, prods.map(r => r.product), requestedQty, priceMap));
    return { accepted, clarify, notFound };
  }

  if (gMatch.type === 'ambiguous') {
    const all = [];
    for (const it of gMatch.candidates) {
      const found = findProductsForKeyword(it.keyword, productIndex);
      for (const p of found) {
        if (!all.some(a => a.id === p.product.id)) {
          all.push(p.product);
        }
      }
    }

    if (!all.length) {
      notFound.push(text);
      return { accepted, clarify, notFound };
    }

    clarify.push(buildClarify(text, all, requestedQty, priceMap));
    return { accepted, clarify, notFound };
  }

  // 3) Directo contra Shopify
  const direct = directProductMatch(coreForGlossary || normalized, productIndex);

  if (direct.type === 'none') {
    notFound.push(text);
    return { accepted, clarify, notFound };
  }

  if (direct.type === 'single') {
    const p = direct.products[0];
    accepted.push({
      product: p,
      variant: (p.variants || [])[0] || {},
      qty: requestedQty
    });
    return { accepted, clarify, notFound };
  }

  clarify.push(buildClarify(text, direct.products, requestedQty, priceMap));
  return { accepted, clarify, notFound };
}

