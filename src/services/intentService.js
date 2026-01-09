// src/services/intentService.js
// ----------------------------------------------------
import { parseQtyFromText, stripFillerForTerms, isLikelyBudgetList } from './textService.js';
import { matchDynamicIntent } from './intentDynamicService.js';

// Respuestas cortas
const YES_RE = /\b(si|sí|dale|ok(ay)?|okey|oki|confirmo|perfecto|joya|va|de una|listo|mandalo|enviame|enviar|pasalo|hacelo|cerralo)\b/i;
const NO_RE = /\b(no|nop|nope|mejor no|dejalo|dejemoslo|más tarde|mas tarde|paso|no gracias|seguimos|continuar|continua|continúa)\b/i;

// Sinónimos base (navegación / sistema)
const VIEW_RE = /\b(ver|resumen|mostrar|mostrame|listado|detalle|estado|como va|cómo va|status)\b/i;
const TABLE_VIEW_RE = /\b(tabla|ver tabla|formato tabla|en tabla)\b/i;
const CONFIRM_RE = /\b(confirmar|cerrar\s*presupuesto|finalizar|generar|hacer\s*pdf|enviar\s*pdf|mandar\s*pdf|mandalo|mandame\s*el\s*pdf|cerralo|ok\b|listo\b|confirmo)\b/i;
const CANCEL_RE = /\b(cancelar|cancelalo|cancelame|cerrar(?!\s*presupuesto)|cerralo|terminar|descartar|borrar\s*todo|vaciar|abortar)\b/i;
const EXIT_RE = /\b(salir|volver|menu|men[uú])\b/i;
const HUMAN_RE = /\b(asesor|humano|vendedor|me atiende alguien|persona)\b/i;
const HELP_RE = /\b(ayuda|help|como funciona|¿como funciona\??|¿cómo funciona\??|comandos?)\b/i;

// Quitar/cambiar por índice
const REMOVE_INDEX_RE = /^\s*quitar\s+(\d+)\s*$/i;
const CHANGE_INDEX_RE = /^\s*cambiar\s+(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*$/i;

// Ajustes relativos
const REL_ADD_RE = /(sumale|agregale|sumar)\s+(\d+(?:[.,]\d+)?)\s+a(l)?\s+(.+)/i;
const REL_SUB_RE = /(sacale|quitale|restale)\s+(\d+(?:[.,]\d+)?)\s+a(l)?\s+(.+)/i;
const REL_DOUBLE_RE = /\b(duplicalo|duplicar|al\s+doble)\b/i;
const REL_HALF_RE = /\b(a\s+la\s+mitad|mitad|dividilo\s+en\s+2|partilo\s+en\s+2|media\s+cantidad)\b/i;

// Quitar último sin especificar
const REMOVE_LAST_RE = /^\s*(sacalo|sacálo|quitalo|quitálo|borralo|borrálo|eliminalo|eliminálo)\s*$/i;

// Catálogo por familia
const LIST_CATEGORY_RE = /\b(que|qué)\s+([\p{L}\d\/\-\s]+?)\s+(tenes|ten[eé]s|hay|disponible|disponibles)\b/iu;

// Presentación / color
const PRESENTATION_RE = /\b(presentaci[oó]n|formato)\b/i;
const COLOR_RE = /\b(color|colores)\b/i;

// FAQs
const HOURS_RE = /\b(horario?s?|abren|cierran|abierto|cerrado)\b/i;
const LOC_RE = /\b(ubicaci[oó]n|d[oó]nde est[aá]n|direccion|direcci[oó]n|como llego)\b/i;
const PAYMENT_RE = /\b(pagos?|tarjeta|efectivo|transferencia|mercado\s*pago|mp)\b/i;
const DELIVERY_RE = /\b(env[ií]o?s?|reparto|delivery|envian|entregan|envio)\b/i;
const STOCK_RE = /\b(stock|hay|disponible|entra|ingresa)\b/i;

export function parseIntent(rawText) {
  const text = String(rawText || '').trim();
  const t = text.toLowerCase();

  // —— LISTA MULTI-LÍNEA → ADD directo —— //
  if (isLikelyBudgetList(text)) {
    return { type: 'ADD', qty: null, terms: null };
  }

  // —— Navegación / sistema —— //
  if (HELP_RE.test(t)) return { type: 'HELP' };
  if (VIEW_RE.test(t)) return { type: 'VIEW' };
  if (TABLE_VIEW_RE.test(t)) return { type: 'VIEW' }; // "tabla" también muestra el resumen (que ya incluye tabla)
  if (t === 'finalize' || CONFIRM_RE.test(t)) return { type: 'CONFIRM' };
  if (t === 'edit' || /\b(editar|edit|modificar lista|cambiar lista)\b/i.test(t)) return { type: 'EDIT' };
  if (t === 'confirm_no' || CANCEL_RE.test(t)) return { type: 'CANCEL' };
  if (EXIT_RE.test(t)) return { type: 'EXIT_HINT' };
  if (HUMAN_RE.test(t)) return { type: 'HUMAN' };

  // —— Intents dinámicos —— //
  const dyn = matchDynamicIntent(t);
  if (dyn) return { type: dyn };

  // —— Respuestas cortas (sí/no) —— //
  if (YES_RE.test(t)) return { type: 'YES' };
  if (NO_RE.test(t)) return { type: 'NO' };

  // —— Compat por índice —— //
  let m = REMOVE_INDEX_RE.exec(text);
  if (m) return { type: 'REMOVE_INDEX', index: Number(m[1]) };
  m = CHANGE_INDEX_RE.exec(text);
  if (m) return { type: 'CHANGE_INDEX', index: Number(m[1]), qty: Number(String(m[2]).replace(',', '.')) };

  // —— Ajustes relativos —— //
  m = REL_ADD_RE.exec(text);
  if (m) return { type: 'REL_ADD', qty: Number(String(m[2]).replace(',', '.')), targetText: m[4] };
  m = REL_SUB_RE.exec(text);
  if (m) return { type: 'REL_SUB', qty: Number(String(m[2]).replace(',', '.')), targetText: m[4] };
  if (REL_DOUBLE_RE.test(t)) return { type: 'REL_DOUBLE', targetText: text };
  if (REL_HALF_RE.test(t)) return { type: 'REL_HALF', targetText: text };

  // Quitar último sin especificar
  if (REMOVE_LAST_RE.test(text)) return { type: 'REMOVE_LAST' };

  // —— Verbos naturales —— //
  const isAdd = /\b(agreg|sum|quiero|necesit|pone(me)?|ponelo|trae(me)?|manda(me)?|presupuestame|pasame|sumame|sumar)\w*\b/.test(t);
  const isRemove =
    /\b(sac|quit|borr|elimin)\w*\b/.test(t) ||
    /\bsin\b/.test(t);
  const isChange = /\b(cambi|modific|dejalo|dejarlo|llevalo|subilo|bajalo|ajustalo|ajustar)\w*\b/.test(t);

  const qty = parseQtyFromText(t);
  const terms = stripFillerForTerms(t);

  if (isAdd) return { type: 'ADD', qty, terms };
  if (isRemove) return { type: 'REMOVE', qty, terms };
  if (isChange) return { type: 'CHANGE', qty, terms };

  // —— Consultas de precio / disponibilidad —— //
  if (/\b(precio|costo|cu[aá]nto sale|ten[eé]s|hay|disponible)\b/.test(t)) {
    return { type: 'PRICE', qty: qty ?? 1, terms };
  }

  // —— Catálogo por familia (genérico) —— //
  const cat = LIST_CATEGORY_RE.exec(text);
  if (cat) {
    const term = (cat[2] || 'producto').toLowerCase().trim();
    return { type: 'LIST_CATEGORY', term };
  }

  // —— Presentación / color —— //
  if (PRESENTATION_RE.test(t)) return { type: 'ASK_PRESENTATION', terms };
  if (COLOR_RE.test(t)) return { type: 'ASK_COLOR', terms };

  // —— FAQs —— //
  if (HOURS_RE.test(t)) return { type: 'FAQ_HOURS' };
  if (LOC_RE.test(t)) return { type: 'FAQ_LOCATION' };
  if (PAYMENT_RE.test(t)) return { type: 'FAQ_PAYMENT' };
  if (DELIVERY_RE.test(t)) return { type: 'FAQ_DELIVERY' };
  if (STOCK_RE.test(t)) return { type: 'FAQ_STOCK', terms };

  // —— Fallback: ADD libre si hay términos —— //
  if (terms) return { type: 'ADD', qty: qty ?? null, terms };

  // —— Nada matcheó —— //
  return { type: 'UNKNOWN' };
}
