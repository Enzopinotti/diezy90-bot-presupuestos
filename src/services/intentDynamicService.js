// src/services/intentDynamicService.js
// ----------------------------------------------------
// Frases dinámicas para intenciones (VIEW / CONFIRM / CANCEL / HUMAN / START)
// guardadas en Redis y cacheadas en memoria (sync-friendly).

import { redis } from '../config/redis.js';

const K_INTENTS = 'd90:intents:v1'; // { view:[], confirm:[], cancel:[], human:[], start:[] }
let MEM = { view:new Set(), confirm:new Set(), cancel:new Set(), human:new Set(), start:new Set() };

function _norm(s='') {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim();
}

export async function loadDynamicIntents() {
  try {
    const raw = await redis.get(K_INTENTS);
    if (!raw) return MEM;
    const obj = JSON.parse(raw);
    MEM.view     = new Set((obj.view||[]).map(_norm));
    MEM.confirm  = new Set((obj.confirm||[]).map(_norm));
    MEM.cancel   = new Set((obj.cancel||[]).map(_norm));
    MEM.human    = new Set((obj.human||[]).map(_norm));
    MEM.start    = new Set((obj.start||[]).map(_norm));
  } catch {}
  return MEM;
}

async function _persist() {
  const obj = {
    view:    Array.from(MEM.view),
    confirm: Array.from(MEM.confirm),
    cancel:  Array.from(MEM.cancel),
    human:   Array.from(MEM.human),
    start:   Array.from(MEM.start),
  };
  await redis.set(K_INTENTS, JSON.stringify(obj));
}

export async function addIntentPhrase(type, phrase) {
  const t = String(type||'').toLowerCase();
  const p = _norm(phrase);
  if (!MEM[t]) throw new Error('Intent type inválido');
  MEM[t].add(p);
  await _persist();
  return true;
}

export async function deleteIntentPhrase(type, phrase) {
  const t = String(type||'').toLowerCase();
  const p = _norm(phrase);
  if (!MEM[t]) throw new Error('Intent type inválido');
  MEM[t].delete(p);
  await _persist();
  return true;
}

export function listIntentPhrases() {
  return {
    view:    Array.from(MEM.view),
    confirm: Array.from(MEM.confirm),
    cancel:  Array.from(MEM.cancel),
    human:   Array.from(MEM.human),
    start:   Array.from(MEM.start),
  };
}

// Matcher SINCRÓNICO (se usa dentro de parseIntent)
export function matchDynamicIntent(textLower='') {
  const t = _norm(textLower);
  const includesAny = (set) => Array.from(set).some(p => t.includes(p));
  if (includesAny(MEM.view))    return 'VIEW';
  if (includesAny(MEM.confirm)) return 'CONFIRM';
  if (includesAny(MEM.cancel))  return 'CANCEL';
  if (includesAny(MEM.human))   return 'HUMAN';
  if (includesAny(MEM.start))   return 'START';
  return null;
}

// Cargar al iniciar el proceso
loadDynamicIntents().catch(()=>{});
