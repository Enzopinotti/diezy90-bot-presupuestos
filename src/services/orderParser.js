// src/services/orderParser.js
// ----------------------------------------------------
// Convierte texto libre multi-linea (WSP) en items normalizados.
// Detecta: categoria, marca, empaque (bolson/bolsita/granel), volumen (m3, 1/2m3),
// peso (kg), litros (l/lt), medidas (60x60, 15x15 4mm 2x5), granulometria (6/20),
// diametro de hierro (8 => 8mm), cantidad xN (ultimo "xN" suele ser qty).
//
// Entrada: string
// Salida: Array<RequestedItem>

import { normalizeTerms, _debug_norm as norm } from './synonyms.js';

const RE_QTY_AT_END = /\bx\s*(\d{1,5})\b$/i;
const RE_SIZE_KG = /\b(\d{1,3})\s*kg\b/;
const RE_SIZE_LT = /\b(\d{1,3})\s*(l|lt|litros?)\b/;
const RE_VOL_M3  = /\b(\d+(?:\/\d+)?)\s*m3\b/; // 1m3, 1/2m3
const RE_DIM_X   = /\b(\d{1,3})\s*x\s*(\d{1,3})(?:\s*x\s*(\d{1,3}))?\b/; // 60x60, 12x18x33
const RE_GRANO   = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/; // 6/20
const RE_MM      = /\b(\d{1,2})\s*mm\b/;

const KNOWN_BRANDS = ['weber','sinteplast','holcim','loma negra','ceresita','tacuru','poximix','muroseal'];
const KNOWN_CATS   = ['arena','piedra','cemento','cal','malla','hierro','ladrillo','hidrofugo','impermeabilizante','pegamento','ceramico','pintura','aislante','rejilla','tornillo'];

function guessCategory(tokens) {
  for (const k of KNOWN_CATS) if (tokens.includes(k)) return k;
  // heuristicas
  if (tokens.includes('porcelanato')) return 'ceramico';
  return null;
}
function guessBrand(tokens){
  for (const b of KNOWN_BRANDS) if (tokens.includes(b)) return b;
  return null;
}
function detectPackaging(line){
  if (/\bbolson(es)?\b/.test(line)) return 'bolson';
  if (/\bbolsita(s)?\b/.test(line) || /\bbolsa(s)?\b/.test(line)) return 'bolsita';
  if (/\bgranel\b/.test(line)) return 'granel';
  return null;
}
function parseVolumeM3(line){
  const m = line.match(RE_VOL_M3);
  if (!m) return null;
  const raw = m[1]; // "1" o "1/2"
  let value = null;
  if (raw.includes('/')) {
    const [a,b] = raw.split('/').map(Number);
    if (a && b) value = a/b;
  } else {
    value = Number(raw);
  }
  return value ? { unit: 'm3', value } : null;
}
function parseKg(line){
  const m = line.match(RE_SIZE_KG);
  return m ? { unit: 'kg', value: Number(m[1]) } : null;
}
function parseLt(line){
  const m = line.match(RE_SIZE_LT);
  return m ? { unit: 'lt', value: Number(m[1]) } : null;
}
function parseDimLine(line){
  // 60x60 | 12x18x33 | 15x15 4mm 2x5
  const dims = [];
  const mm   = [];
  let m = RE_DIM_X.exec(line);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const c = m[3] ? Number(m[3]) : null;
    dims.push(a,b); if (c) dims.push(c);
  }
  let mmx = RE_MM.exec(line);
  if (mmx) mm.push(Number(mmx[1]));
  return { dims: dims.length ? dims : null, mm: mm.length ? mm : null };
}
function parseGranulometry(line){
  const g = RE_GRANO.exec(line);
  return g ? `${Number(g[1])}/${Number(g[2])}` : null;
}
function takeQty(line){
  const m = line.match(RE_QTY_AT_END);
  if (m) return Number(m[1]);
  return null;
}

// caso especial: "cemento cpc40 x25 x10" => 25kg, qty=10
function splitDoubleX(line, cat){
  const xs = [...line.matchAll(/\bx\s*(\d{1,4})([a-z]{1,3})?/g)];
  if (xs.length < 2) return { line, sizeHint: null, qtyHint: null };
  let sizeHint = null, qtyHint = null;
  for (const x of xs) {
    const num = Number(x[1]);
    const unit = (x[2]||'').toLowerCase();
    if (!qtyHint && !unit && num > 0) qtyHint = num;
    if (!sizeHint && (unit==='kg'||unit==='l'||unit==='lt')) sizeHint = { unit: unit==='kg'?'kg':'lt', value: num };
    // Heuristica por categoria
    if (!sizeHint && !unit && cat==='cemento' && num>=20 && num<=50) sizeHint = { unit:'kg', value:num };
  }
  // limpiar los "x..." de la linea para evitar duplicar
  const clean = line.replace(/\bx\s*\d{1,4}([a-z]{1,3})?/g, '').replace(/\s+/g,' ').trim();
  return { line: clean, sizeHint, qtyHint };
}

export function parseOrderText(raw=''){
  const lines = normalizeTerms(raw).split(/\n|\r/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (let line of lines) {
    const original = line;

    // tokens
    const tokens = line.split(' ').filter(Boolean);

    const category = guessCategory(tokens);
    const brand    = guessBrand(tokens);
    const packaging = detectPackaging(line);

    // doble "x" (tamano + qty)
    const dd = splitDoubleX(line, category);
    line = dd.line;

    // cantidad (xN al final)
    let quantity = takeQty(line);
    if (!quantity && dd.qtyHint) quantity = dd.qtyHint;
    if (!quantity) quantity = 1;

    // atributos
    const volume = parseVolumeM3(line) || null;
    const sizeKg = parseKg(line) || dd.sizeHint || null;
    const sizeLt = parseLt(line) || null;
    const { dims, mm } = parseDimLine(line);
    const granulometry = parseGranulometry(line);

    // numeros sueltos tipo "hierro 8" => 8mm
    let diameterMm = null;
    if (category==='hierro' && !mm && /\b(\d{4,})\b/.test(line)===false) {
      const mmM = line.match(/\b(\d{1,2})\b/);
      if (mmM) diameterMm = Number(mmM[1]);
    } else if (mm && mm.length) {
      diameterMm = mm[0];
    }

    // dimensiones “60x60” o “12x18x33”
    let dimensionStr = null;
    if (dims) dimensionStr = dims.join('x');

    const requested = {
      original,
      normalized: normalizeTerms(original),
      tokens,
      category,
      brand,
      packaging,         // 'bolson'|'bolsita'|'granel'|null
      volume,            // {unit:'m3', value}
      sizeKg,            // {unit:'kg', value}
      sizeLt,            // {unit:'lt', value}
      granulometry,      // '6/20'
      diameterMm,        // number
      dimensionStr,      // '60x60' | '12x18x33'
      quantity
    };
    out.push(requested);
  }
  return out;
}
