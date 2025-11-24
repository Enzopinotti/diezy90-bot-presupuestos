// src/services/trainerService.js
// ----------------------------------------------------
// Heurísticas para proponer nuevas frases de intent y sinónimos.

import { levenshtein } from './fuzzyService.js';

function norm(s='') {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim();
}

function topCounts(arr, keyFn=(x)=>x, min=2) {
  const m = new Map();
  for (const a of arr) {
    const k = keyFn(a);
    if (!k) continue;
    m.set(k, (m.get(k)||0)+1);
  }
  return Array.from(m.entries())
    .map(([k,v])=>({value:k, count:v}))
    .filter(x=>x.count>=min)
    .sort((a,b)=>b.count-a.count);
}

function guessIntent(phrase) {
  const t = norm(phrase);
  const has = (re) => re.test(t);
  if (has(/\b(mostr(a|ame)|ver|estado|resumen|como va|cómo va)\b/)) return 'view';
  if (has(/\b(cancel(a|alo|ame)|cerr(a|alo|ame)\b|chau|listo chau)/)) return 'cancel';
  if (has(/\b(confirm(a|ame)|listo|mandame el pdf|enviar pdf|cerrar presupuesto)\b/)) return 'confirm';
  if (has(/\b(asesor|humano|me atiende alguien|persona|vendedor)\b/)) return 'human';
  if (has(/\b(presupuesto|empezar de cero|nuevo|arranquemos|empecemos|hacer otro)\b/)) return 'start';
  return null;
}

export function suggestAll({ unknown=[], notfound=[], productIndex=[] }) {
  // 1) Frases desconocidas → intent candidates
  const uText = unknown.map(u => norm(u.text||'')).filter(Boolean);
  const uTop = topCounts(uText, x=>x, 2);
  const intentSuggestions = uTop
    .map(({value,count}) => ({ phrase:value, count, intent:guessIntent(value) }))
    .filter(s => !!s.intent);

  // 2) Not found → candidatos a sinónimo (mapear a título más cercano)
  const terms = [];
  for (const row of notfound) for (const t of (row.terms||[])) terms.push(norm(t));
  const nfTop = topCounts(terms, x=>x, 2);

  const productTokens = productIndex.map(p => (p.title||'').toLowerCase());
  const synonymSuggestions = nfTop.map(({value,count}) => {
    let best=null, bestScore=9999;
    for (const tok of productTokens) {
      const d = levenshtein(value, tok);
      if (d < bestScore) { bestScore = d; best = tok; }
    }
    return { from:value, to:best, distance:bestScore, count };
  }).filter(s => s.to && s.distance <= Math.max(2, Math.round(s.from.length*0.25)));

  return {
    intents: intentSuggestions.slice(0, 50),
    synonyms: synonymSuggestions.slice(0, 50)
  };
}
