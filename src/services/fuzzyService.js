// src/services/fuzzyService.js
// ----------------------------------------------------
// Fuzzy matching liviano (Levenshtein) y helpers de búsqueda.

export function levenshtein(a, b) {
  a = String(a || '');
  b = String(b || '');
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[al][bl];
}

export function fuzzyIncludes(needle, haystackTokenList = [], maxDistance = 2) {
  const n = String(needle || '').toLowerCase();
  return haystackTokenList.some(t => levenshtein(n, String(t).toLowerCase()) <= maxDistance);
}

// Retorna top-K productos por similitud contra tokens del título
export function bestMatches(words, products, k = 5) {
  const W = (words || []).map(w => String(w).toLowerCase()).filter(w => w.length >= 3);
  const scored = [];
  for (const p of products) {
    const base = String(p.title || '').toLowerCase();
    let best = 999;
    for (const w of W) best = Math.min(best, levenshtein(base, w));
    scored.push({ p, score: best });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, k).map(x => x.p);
}
