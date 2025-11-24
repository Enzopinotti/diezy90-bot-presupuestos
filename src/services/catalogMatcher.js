// src/services/catalogMatcher.js
// ----------------------------------------------------
// Dado un RequestedItem y candidatos del catalogo, calcula un score y selecciona el mejor.
// Reglas fuertes: packaging (bolson vs bolsita vs granel), volumen m3, kg, litros, dimensiones, granulometria, marca.
// Reglas suaves: tokens contenidos en nombre/SKU, categoria coincidente.
//
// fetchCandidates: fn async (requestedItem) => Array<Product>
//   Product esperado (campos tipicos; mapea lo que tengas):
//   {
//     id, name, brand, category,
//     packaging: 'bolson'|'bolsita'|'granel'|null,
//     volumeM3: number|null,
//     weightKg: number|null,
//     liters: number|null,
//     diameterMm: number|null,
//     granulometry: '6/20'|null,
//     dimensions: '60x60'|'12x18x33'|'2x5'|null, // string libre
//     unitName: 'KG'|'UN'|'M3'|...,
//     price: number
//   }

function tokenizeName(name=''){
  return String(name).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/[^\w/ x]/g,' ')
    .replace(/\s+/g,' ').trim().split(' ');
}

function almostEqual(a,b,tol=0.12){ // 12%
  if (a==null || b==null) return false;
  const d = Math.abs(a-b);
  return d <= Math.max(1, b*tol);
}

function scoreProduct(req, p){
  let score = 0;

  // Categoria & marca
  if (req.category && p.category && req.category===p.category) score += 8;
  if (req.brand && p.brand && req.brand===p.brand) score += 6;

  // Packaging
  if (req.packaging) {
    if (p.packaging === req.packaging) score += 12;
    else score -= 15; // castigo fuerte
  }

  // Volumen m3
  if (req.volume && req.volume.value!=null) {
    if (almostEqual(p.volumeM3, req.volume.value, 0.15)) score += 14;
    else score -= 12;
  }

  // Peso (kg)
  if (req.sizeKg && req.sizeKg.value!=null) {
    if (almostEqual(p.weightKg, req.sizeKg.value, 0.12)) score += 10;
    else score -= 6;
  }

  // Litros
  if (req.sizeLt && req.sizeLt.value!=null) {
    if (almostEqual(p.liters, req.sizeLt.value, 0.12)) score += 10;
    else score -= 6;
  }

  // Diametro hierro
  if (req.diameterMm!=null) {
    if (p.diameterMm!=null && Math.abs(p.diameterMm - req.diameterMm)<=1) score += 10;
    else score -= 5;
  }

  // Granulometria piedra 6/20
  if (req.granulometry) {
    if (p.granulometry && p.granulometry === req.granulometry) score += 12;
    else {
      // si no trae campo, pero el nombre lo contiene
      const name = (p.name||'').toLowerCase();
      if (name.includes(req.granulometry)) score += 8; else score -= 6;
    }
  }

  // Dimensiones (ceramico, ladrillo, malla, etc.)
  if (req.dimensionStr) {
    const dim = (p.dimensions||'').toLowerCase();
    const name = (p.name||'').toLowerCase();
    if (dim.includes(req.dimensionStr) || name.includes(req.dimensionStr)) score += 10;
    else score -= 6;
  }

  // Tokens blandos en nombre
  const nameTokens = tokenizeName(p.name||'');
  const softHits = req.tokens.filter(t => nameTokens.includes(t)).length;
  score += softHits * 1.5;

  // Salvaguarda: si packaging es bolsita y pedido fue bolson 1m3 => castigo extra
  if (req.packaging==='bolson' && (p.packaging==='bolsita')) score -= 20;

  return score;
}

export async function matchRequestedItems(requestedItems, fetchCandidates){
  const matched = [];
  const pending = [];

  for (const req of requestedItems) {
    const candidates = await fetchCandidates(req); // tu consulta por LIKEs, por categoria y tokens
    if (!candidates || !candidates.length) {
      pending.push({ requested: req, reason: 'sin candidatos' });
      continue;
    }
    const scored = candidates
      .map(p => ({ p, score: scoreProduct(req, p) }))
      .sort((a,b)=> b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 6) { // umbral prudente
      pending.push({ requested: req, reason: 'score bajo', top: scored.slice(0,3) });
      continue;
    }

    matched.push({
      requested: req,
      product: best.p,
      score: best.score
    });
  }
  return { matched, pending };
}
