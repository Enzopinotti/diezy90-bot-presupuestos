// src/services/insightsService.js
// ----------------------------------------------------
import { redis } from '../config/redis.js';

const K_UNKNOWN = 'd90:insights:unknown';
const K_NOTFOUND = 'd90:insights:notfound';
const MAX = 2000;

export async function logUnknown({ phone, text, mode = 'BUDGET' }) {
  const item = JSON.stringify({ t: Date.now(), phone, text, mode });
  await redis.lpush(K_UNKNOWN, item);
  await redis.ltrim(K_UNKNOWN, 0, MAX - 1);
}

export async function logNotFound({ phone, terms }) {
  if (!terms || !terms.length) return;
  const item = JSON.stringify({ t: Date.now(), phone, terms });
  await redis.lpush(K_NOTFOUND, item);
  await redis.ltrim(K_NOTFOUND, 0, MAX - 1);
}

export async function exportUnknown(limit = 500) {
  const rows = await redis.lrange(K_UNKNOWN, 0, limit - 1);
  return rows.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export async function exportNotFound(limit = 500) {
  const rows = await redis.lrange(K_NOTFOUND, 0, limit - 1);
  return rows.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

// -------- Tallies útiles --------
function _norm(s='') {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim();
}

export async function exportUnknownTally(limit=2000) {
  const rows = await exportUnknown(limit);
  const m = new Map();
  for (const r of rows) {
    const k = _norm(r.text||'');
    if (!k) continue;
    m.set(k, (m.get(k)||0)+1);
  }
  return Array.from(m.entries()).map(([text,count])=>({text,count})).sort((a,b)=>b.count-a.count);
}

export async function exportNotFoundTally(limit=2000) {
  const rows = await exportNotFound(limit);
  const m = new Map();
  for (const r of rows) {
    for (const t of (r.terms||[])) {
      const k = _norm(t);
      if (!k) continue;
      m.set(k, (m.get(k)||0)+1);
    }
  }
  return Array.from(m.entries()).map(([term,count])=>({term,count})).sort((a,b)=>b.count-a.count);
}

// -------- Limpieza por antigüedad --------
export async function clearInsightsOlderThan(days = 30) {
  const ms = days * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ms;

  const clean = async (key) => {
    const rows = await redis.lrange(key, 0, MAX);
    const kept = [];
    for (const r of rows) {
      try {
        const obj = JSON.parse(r);
        if (obj.t >= cutoff) kept.push(r);
      } catch {}
    }
    await redis.del(key);
    if (kept.length) await redis.lpush(key, ...kept);
    return rows.length - kept.length;
  };

  const remUnknown = await clean(K_UNKNOWN);
  const remNotFound = await clean(K_NOTFOUND);
  return { removedUnknown: remUnknown, removedNotFound: remNotFound };
}
