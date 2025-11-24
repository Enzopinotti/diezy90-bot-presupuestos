// src/services/textService.js
// ----------------------------------------------------
// Heurísticas y helpers para parsear listas de presupuesto.

function _normBase(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/** Palabras comunes del rubro para ayudar a detectar "lista de cosas" */
const DOMAIN_HINTS = [
  'arena', 'piedra', 'escombro', 'tosca',
  'cemento', 'cal', 'plasticor', 'hidrofugo', 'impermeabilizante', 'pegamento',
  'malla', 'hierro', 'alambre', 'clavo', 'tornillo', 'rejilla',
  'ladrillo', 'ceramico', 'porcelanato', 'pintura', 'latex', 'aislante', 'vigueta',
  'weber', 'sinteplast', 'murosel', 'muroseal', 'porcelanato'
];

/** Mapa de números hablados a dígitos */
const SPOKEN_NUMBERS_MAP = {
  'un': 1, 'una': 1, 'uno': 1,
  'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
  'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
  'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
  'dieciseis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
  'veintiuno': 21, 'veintidos': 22, 'veintitres': 23, 'veinticuatro': 24, 'veinticinco': 25,
  'treinta': 30, 'cuarenta': 40, 'cincuenta': 50
};

/** Normaliza números hablados a dígitos en el texto */
export function normalizeSpokenNumbers(text = '') {
  let t = text.toLowerCase();
  // Reemplazar palabras completas por números
  for (const [word, num] of Object.entries(SPOKEN_NUMBERS_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    t = t.replace(regex, num.toString());
  }
  return t;
}

/** Palabras que no queremos que queden como "pendientes" */
export const RESERVED_TOKENS = new Set([
  'ver', 'confirmar', 'confirmalo', 'confirmame', 'cancelar', 'cancelalo', 'cancelame', 'pdf',
  'catalogo', 'catálogo', 'asesor', 'hola', 'buenas', 'menu', 'menú', 'inicio', 'start',
  'precio', 'precios', 'costo', 'hay', 'tenes', 'tenés', 'disponible', 'stock',
  'horario', 'horarios', 'ubicacion', 'ubicación', 'envio', 'envío', 'delivery'
]);

/**
 * Limpia una línea pero preserva tokens importantes:
 * dígitos, x/por/a para cantidades, barras de medidas (6/20), puntos y comas decimales.
 */
export function sanitizeText(s = '') {
  const t = _normBase(s).toLowerCase();
  return t
    .replace(/[^\p{L}\p{N}\s/.,x-]/gu, ' ') // letras, números, espacio, / . , x -
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split robusto por líneas, bullets, o ';' / '•' en un mismo renglón */
export function splitLinesSmart(text) {
  if (!text) return [];
  // Normalizar saltos de línea y separar por:
  // 1. Saltos de línea (\n)
  // 2. Puntos seguidos de espacio (\.\s+) -> Para separar oraciones "Hola. Quisiera..."
  const lines = text.split(/\n+|\.\s+/).map(l => l.trim()).filter(Boolean);

  const result = [];
  for (const line of lines) {
    // Si una línea contiene múltiples elementos separados por ';' o '•', dividirlos
    const subParts = line.split(/[;•]+/).map(s => s.trim()).filter(Boolean);
    result.push(...subParts);
  }

  // Si alguien pegó todo en una sola línea con comas, separamos cuando haya patrón "... xN," repetido
  if (result.length === 1) {
    const one = result[0];

    // Patrón 1: "x N" (ej: arena x 3, piedra x 4)
    const hasManyQty = (one.match(/\b(?:x|por|a)\s*\d+(?:[.,]\d+)?\b/gi) || []).length >= 2;

    // Patrón 2: "N de Producto" (ej: 3 de arena, dos de piedra)
    // Detecta dígitos o palabras numéricas seguidas de "de"
    const dePattern = /\b(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta)\s+de\s+\w+/gi;
    const hasManyDe = (one.match(dePattern) || []).length >= 2;

    if (hasManyQty || hasManyDe) {
      // Separar por:
      // 1. Comas no seguidas de dígito: /,(?!\d)/
      // 2. " y " con espacios: /\s+y\s+/
      // 3. Puntos seguidos de espacio (final de oración): /\.\s+/
      return one.split(/,(?!\d)|\s+y\s+|\.\s+/).map(s => s.trim()).filter(Boolean);
    }
  }

  return result;
}

/** Extrae una cantidad "global" del texto (para intents rápidos). Toma la última coincidencia. */
export function parseQtyFromText(text = '') {
  const t = _normBase(text).toLowerCase();
  const matchs = [...t.matchAll(/\b(?:x|por|a)\s*(\d+(?:[.,]\d+)?)\b/g)];
  if (!matchs.length) return null;
  const last = matchs[matchs.length - 1][1];
  return Number(String(last).replace(',', '.'));
}

/** Saca "relleno" para quedarse con términos de búsqueda sueltos */
export function stripFillerForTerms(text = '') {
  const t = _normBase(text).toLowerCase();
  const out = t
    // verbos comunes de interacción
    .replace(/\b(agrega?me?|sum(a|ar)|pone?me?|presupuest(a|ame)|pas(a|ame)|quiero|necesito)\b/g, ' ')
    // pedidos de precio y similares
    .replace(/\b(precio|precios|costo|cuanto\s*sale|hay|tenes|ten[eé]s|disponible)\b/g, ' ')
    // conectores comunes
    .replace(/\b(por\s*favor|pf|gracias|hola|buenas|buen\s*d[ií]a|men[uú]|menu|inicio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || null;
}

/**
 * ¿Parece una lista de presupuesto?
 * Señales:
 *  - 2+ renglones "válidos"
 *  - Cantidad de patrones tipo "xN / por N / a N"
 *  - Presencia de varias palabras del rubro
 *  - Muchos números repartidos
 *  - Patrones de audio: "dos de arena", "4 de piedra" (números en palabras o dígitos)
 */
export function isLikelyBudgetList(raw = '') {
  const lines = splitLinesSmart(raw);
  const validLines = lines.filter(l => sanitizeText(l).length >= 3);

  if (validLines.length >= 3) return true; // Tres o más renglones ya es fuertísimo.

  // Dos líneas con señales fuertes
  const t = sanitizeText(raw);
  const qtyHits = (t.match(/\b(?:x|por|a)\s*\d+(?:[.,]\d+)?\b/gi) || []).length;
  const numHits = (t.match(/\d+/g) || []).length;

  const domHits = DOMAIN_HINTS.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);

  if (validLines.length >= 2 && (qtyHits >= 1 || domHits >= 2 || numHits >= 4)) return true;

  // Detección de patrones de AUDIO (números en palabras + productos)
  // Patrones como: "dos de arena", "tres de cemento", "cuatro de piedra"
  const spokenNumbers = /\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta)\b/gi;
  const spokenNumMatches = (t.match(spokenNumbers) || []).length;

  // Patrón "X de Y" con números en palabras
  const dePatternWords = /\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta)\s+de\s+\w+/gi;
  const deMatchesWords = (t.match(dePatternWords) || []).length;

  // Patrón "X de Y" con dígitos: "4 de piedra", "5 de cemento"
  const dePatternDigits = /\b\d+\s+de\s+\w+/gi;
  const deMatchesDigits = (t.match(dePatternDigits) || []).length;

  // Si tiene múltiples números hablados + palabras del dominio, es una lista
  if (spokenNumMatches >= 2 && domHits >= 2) return true;

  // Si tiene patrón "X de Y" múltiple (palabras o dígitos), es una lista
  if (deMatchesWords >= 2 || deMatchesDigits >= 2) return true;

  // Si tiene números (dígitos o palabras) + productos del dominio, es una lista
  if ((numHits >= 2 || spokenNumMatches >= 2) && domHits >= 2) return true;

  return false;
}