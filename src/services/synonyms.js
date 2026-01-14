// src/services/synonyms.js
// ----------------------------------------------------
// Normalización de términos: estáticos + DINÁMICOS en Redis (sin redeploy).
// NOTA: mantenemos todo en ASCII (sin tildes) para evitar problemas de matching.

import { redis } from '../config/redis.js';

const TOKEN_MAP = new Map([
  // Materiales base
  ['ripio', 'piedra'],
  ['granitica', 'piedra'],
  ['granita', 'piedra'],
  ['piedra 6-20', 'piedra 6/20'],
  ['arena grano fino', 'arena'],
  ['volquete', 'granel'],

  // Presentaciones empaques (solo normaliza texto; la logica de empaque la hace el parser)
  ['bolson', 'bolson'],
  ['bolsones', 'bolson'],
  ['bolsita', 'bolsita'],
  ['bolsitas', 'bolsita'],
  ['bolsa', 'bolsita'],
  ['bolsas', 'bolsita'],
  ['a granel', 'granel'],

  // Cemento/marcas
  ['holcim', 'holcim'],
  ['loma negra', 'loma negra'],
  ['portland', 'cemento'],
  ['plasticor', 'cemento'], // Marca común
  ['cpc40', 'cpc40'],

  // Cal
  ['cal aerea', 'cal'],
  ['cal hidratada', 'cal'],
  ['hidraulica', 'hidraulica'],

  // Químicos / Marcas
  ['hidrofugo', 'hidrofugo'],
  ['ceresita', 'ceresita'],
  ['sinteplast', 'sinteplast'],
  ['weber', 'weber'],
  ['muroseal', 'muroseal'],
  ['poroceanato', 'porcelanato'],
  ['porcelanatto', 'porcelanato'],

  // Acero - IMPORTANTE: 'hierro' es como está en Shopify, 'varilla' es como la gente lo pide.
  ['varilla', 'hierro'],
  ['varillas', 'hierro'],
  ['fi', 'hierro'],
  ['barra', 'hierro'],
  ['barras', 'hierro'],
  ['fierro', 'hierro'],
  ['fierros', 'hierro'],
  ['variya', 'hierro'],
  ['variyas', 'hierro'],

  // Revestimientos
  ['ceramica', 'ceramico'],
  ['ceramico', 'ceramico'],
  ['porcelanato', 'ceramico'],

  // Ladrillos
  ['hueco', 'ladrillo'],
  ['pallet', 'pallet'],
  ['palets', 'pallet'],
  ['pallets', 'pallet'],
  ['palet', 'pallet'],
]);

const K_DYN = 'd90:synonyms:dynamic';
let DYNAMIC_MAP = new Map();

function norm(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadDynamicSynonyms() {
  try {
    const raw = await redis.get(K_DYN);
    if (!raw) return DYNAMIC_MAP;
    const obj = JSON.parse(raw);
    DYNAMIC_MAP = new Map(Object.entries(obj).map(([k, v]) => [norm(k), norm(v)]));
  } catch { }
  return DYNAMIC_MAP;
}
async function persistDynamic() {
  const obj = Object.fromEntries(DYNAMIC_MAP.entries());
  await redis.set(K_DYN, JSON.stringify(obj));
}

export async function addDynamicSynonym(from, to) {
  DYNAMIC_MAP.set(norm(from), norm(to));
  await persistDynamic();
  return true;
}
export async function deleteDynamicSynonym(from) {
  DYNAMIC_MAP.delete(norm(from));
  await persistDynamic();
  return true;
}
export async function listDynamicSynonyms() {
  if (!DYNAMIC_MAP.size) await loadDynamicSynonyms();
  return Object.fromEntries(DYNAMIC_MAP.entries());
}

export function normalizeTerms(text = '') {
  let t = norm(text);
  // estáticos
  for (const [from, to] of TOKEN_MAP.entries()) {
    const f = norm(from);
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g');
    t = t.replace(re, to);
  }
  // dinámicos
  for (const [from, to] of DYNAMIC_MAP.entries()) {
    const f = norm(from);
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g');
    t = t.replace(re, to);
  }
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// Cargar al iniciar
loadDynamicSynonyms().catch(() => { });

export const _debug_norm = norm;
