// /src/services/matchService.js
import fs from 'fs/promises';
import path from 'path';

let glossary = null;

async function loadGlossary() {
  if (glossary) return glossary;
  const p = path.resolve('src/data/glossary.json');
  const raw = await fs.readFile(p, 'utf-8');
  glossary = JSON.parse(raw);
  return glossary;
}

/**
 * Recibe texto libre y devuelve intent + posibles ítems normalizados del catálogo.
 * Esta es una versión stub. En el sprint 2 agregamos similitudes, medidas, plurales y desambiguación.
 */
export async function matchFromText(text, productIndex) {
  const g = await loadGlossary();
  const tokens = text.toLowerCase().split(/[^a-z0-9áéíóúñ/\.]+/i).filter(Boolean);

  // Buscar por sinónimos simples
  const candidates = [];
  for (const token of tokens) {
    for (const entry of g) {
      if (entry.aliases.includes(token)) {
        // Elegir primer variant coincidente por nombre (muy básico)
        const found = productIndex.find(p => p.title.toLowerCase().includes(entry.keyword));
        if (found) {
          const variant = found.variants[0];
          candidates.push({ product: found, variant, qty: entry.defaultQty || 1 });
        }
      }
    }
  }
  return candidates;
}