// src/controllers/wati/utils.js
// ----------------------------------------------------
import { env } from '../../config/env.js';
import { computeLineTotals } from '../../services/priceService.js';
import { RESERVED_TOKENS } from '../../services/textService.js';

export function helpBudgetShort() {
  return [
    '📝 *Como enviar tu lista:*',
    '',
    '✍️ *Escribiendo:* _2 arena, 5 cemento, 1 piedra_',
    '📷 *Con foto:* Sacá una foto de tu lista',
    '🎤 *Con audio:* Grabá un mensaje de voz'
  ].join('\n');
}

export function currencyFmt(n) {
  return new Intl.NumberFormat(env.currencyLocale, {
    style: 'currency',
    currency: 'ARS'
  }).format(n);
}

function pad(str, len) {
  const s = String(str ?? '');
  if (s.length > len) return s.slice(0, Math.max(0, len - 1)) + '…';
  return s.padEnd(len, ' ');
}
function padL(str, len) {
  const s = String(str ?? '');
  if (s.length > len) return s.slice(s.length - len);
  return s.padStart(len, ' ');
}

function validityLine() {
  const days = Number(env?.business?.budgetValidityDays ?? 1);
  const text = days === 1 ? '1 día' : `${days} días`;
  return `🕘 Validez de precios: ${text}.`;
}

function commandsHintLine() {
  // Removido porque ahora usamos botones
  return '';
}

function buildAsciiTable(items = []) {
  // Columnas: #, Ítem, Cant, Unit, Subtotal
  // Ajustadas para que la línea total no sea tan larga
  const W = { idx: 2, title: 32, qty: 5, unit: 11, sub: 12 };

  const header =
    `${pad('#', W.idx)}  ${pad('Ítem', W.title)}  ${padL('Cant', W.qty)}  ${padL('Unit', W.unit)}  ${padL('Subtotal', W.sub)}`;

  const rows = (items || []).map((it, i) => {
    const title = String(it?.title ?? '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    const unit = qty > 0 ? (it?.amounts?.lista || 0) / qty : 0;
    const sub = Number(it?.amounts?.lista || 0);

    return (
      `${pad(String(i + 1), W.idx)}  ` +
      `${pad(title, W.title)}  ` +
      `${padL(String(qty), W.qty)}  ` +
      `${padL(currencyFmt(unit), W.unit)}  ` +
      `${padL(currencyFmt(sub), W.sub)}`
    );
  });

  const hr = '-'.repeat(W.idx + 2 + W.title + 2 + W.qty + 2 + W.unit + 2 + W.sub);

  return ['```', header, hr, ...rows, '```'].join('\n');
}

/** Resumen enriquecido (numerado + totales + validez + comandos + no encontrados) */
export function renderSummary(items = [], notFound = []) {
  const list = Array.isArray(items) ? items : [];

  // Si no hay items ni notFound, retornar mensaje simple
  if (!list.length && !notFound?.length) {
    return '📝 Tu presupuesto está vacío.\n\nEnviame tu lista de materiales para empezar.';
  }

  // Totales
  const tot = list.reduce((a, i) => ({
    lista: a.lista + (i?.amounts?.lista || 0),
    transferencia: a.transferencia + (i?.amounts?.transferencia || 0),
    efectivo: a.efectivo + (i?.amounts?.efectivo || 0)
  }), { lista: 0, transferencia: 0, efectivo: 0 });

  const out = [];

  // Solo agregar encabezado y lista si hay items
  if (list.length) {
    out.push('🧾 *Presupuesto*');
    out.push('```');
    // Header compacto para pantallas móviles
    out.push('CANT PRODUCTO           TOTAL');
    out.push('------------------------------');

    list.forEach((i, idx) => {
      // Formato compacto para móvil: "2  NombreProd... $12.000"
      // QTY (2) | TITLE (19) | PRICE (10)
      let title = String(i?.title ?? '').trim().substring(0, 19);
      const qty = (Number(i?.qty ?? 0) || 0);
      const qtyPad = qty.toString().padEnd(2);

      // Si es m2, mostrar una línea secundaria o ajustar el nombre
      if (i.unit === 'm2' && i.boxSize > 1) {
        const totalM2 = (qty * i.boxSize).toFixed(2);
        // Intentar meter el m2 en el nombre si cabe, o solo mostrar
        title = `${title}`.substring(0, 13) + ` (${totalM2}m2)`;
      }

      // Precio compacto sin signo $ para ahorrar espacio
      const rawPrice = Math.round(i?.amounts?.lista || 0);
      const formattedPrice = rawPrice.toLocaleString('es-AR');
      const sub = `$${formattedPrice}`;

      const line = `${qtyPad} ${title.padEnd(19)} ${sub.padStart(10)}`;
      out.push(line);
    });

    out.push('```');
    out.push('');
    out.push(`💵 *TOTAL: ${currencyFmt(tot.efectivo)}*`);
    out.push('');
    out.push('_*Precio de referencia en efectivo_');
    out.push('');
    out.push(validityLine());
    out.push('');
    out.push('⚠️ *Flete a confirmar según zona y cantidad*');
  }

  const nf = (notFound || []).filter(s => !RESERVED_TOKENS.has(String(s).toLowerCase()));
  if (nf.length) {
    out.push('', '⚠️ *Pendientes / especiales*', ...nf.map(s => `• ${s}`));
  }

  return out.join('\n');
}

export function norm(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}# ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export const GREETINGS = new Set([
  'HOLA', 'HOLA BUEN DIA', 'HOLA BUENOS DIAS', 'HOLA BUENAS', 'HOLA QUE TAL',
  'BUENAS', 'BUEN DIA', 'BUENOS DIAS', 'QUE TAL', 'INICIO', 'MENU', 'MEN U', 'MENÚ',
  'START', 'COMENZAR', 'EMPEZAR', 'HELLO', 'HI'
]);

export function ensureSession(sess) {
  if (!sess) {
    return {
      mode: null,
      items: [],
      notFound: [],
      pending: null,
      pendingSelect: null,
      pendingConfirm: null,
      pendingCancel: null,
      startedAt: Date.now(),
      lastAction: null,
    };
  }
  if (!Array.isArray(sess.items)) sess.items = [];
  if (!Array.isArray(sess.notFound)) sess.notFound = [];
  if (sess.pendingSelect === undefined) sess.pendingSelect = null;
  if (sess.pendingConfirm === undefined) sess.pendingConfirm = null;
  if (sess.pendingCancel === undefined) sess.pendingCancel = null;
  if (sess.lastAction === undefined) sess.lastAction = null;
  return sess;
}

export function mergeSameItems(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = it.variantId || it.title;
    if (!map.has(key)) {
      map.set(key, { ...it });
    } else {
      const acc = map.get(key);
      const unit = acc.amounts.lista / Math.max(1, acc.qty);
      const newQty = acc.qty + it.qty;
      acc.qty = newQty;
      acc.amounts = computeLineTotals({ price: unit }, newQty);
      // Preservar metadatos de unidad/m2 si existen
      if (it.unit) acc.unit = it.unit;
      if (it.boxSize) acc.boxSize = it.boxSize;
      map.set(key, acc);
    }
  }
  return Array.from(map.values());
}

/** —— NUEVO / CONTINUAR en lenguaje natural —— */
export function isNewCommand(textNorm = '') {
  const t = String(textNorm || '');
  return !!(
    /\bNUEVO\b/.test(t) ||
    /\bUNO NUEVO\b/.test(t) ||
    /\bOTRO PRESUPUESTO\b/.test(t) ||
    /\bEMPEZAR DE CERO\b/.test(t) ||
    /\bARRANQUEMOS\b/.test(t) ||
    /\bEMPECEMOS\b/.test(t) ||
    /\bHACER OTRO\b/.test(t) ||
    /\bEMPEZAR\s+NUEVO\b/.test(t)
  );
}

export function isContinueCommand(textNorm = '') {
  const t = String(textNorm || '');
  return !!(
    /\bCONTINUAR(?!\w)/.test(t) ||
    /\bCONTINUEMOS\b/.test(t) ||
    /\bREANUDAR\b/.test(t) ||
    /\bRETOMAR\b/.test(t) ||
    /\bSEGUIR\b/.test(t) ||
    /\bSIGAMOS\b/.test(t) ||
    /\bRETOMEMOS\b/.test(t) ||
    /\bVOLVER\b/.test(t) ||
    /\bVOLVAMOS\b/.test(t) ||
    /\bCONTINUEME?LO?\b/.test(t)
  );
}
