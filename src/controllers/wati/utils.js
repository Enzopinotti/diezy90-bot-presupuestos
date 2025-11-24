// src/controllers/wati/utils.js
// ----------------------------------------------------
import { env } from '../../config/env.js';
import { computeLineTotals } from '../../services/priceService.js';
import { RESERVED_TOKENS } from '../../services/textService.js';

export function helpBudgetShort() {
  return [
    '📝 *¿Cómo envío mi lista?*',
    '',
    '✍️ *Por texto:*',
    'Escribí los productos que necesitás, por ejemplo:',
    '• _2 arena_',
    '• _5 cemento_',
    '• _1 piedra bolsón_',
    '',
    '📷 *Con foto:*',
    'Sacale una foto nítida a tu lista y enviala',
    '',
    '🎤 *Por audio:*',
    'Grabá un audio diciendo lo que necesitás',
    '',
    ' Cuando termines, escribí *CONFIRMAR* para recibir el PDF'
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
  return '⌨️ Comandos: *CONFIRMAR* (para PDF) • *CANCELAR*';
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

  // Listado numerado amigable y MOBILE FRIENDLY
  // Formato:
  // 1. Ladrillo Hueco 12x18x33
  //    x 100  |  $ 150  |  $ 15.000
  const bulletLines = list.length
    ? list.map((i, idx) => {
      const title = String(i?.title ?? '').trim();
      const qty = Number(i?.qty ?? 0) || 0;
      const unit = currencyFmt((i?.amounts?.lista || 0) / Math.max(qty, 1));
      const sub = currencyFmt(i?.amounts?.lista || 0);

      return `${idx + 1}. *${title}*\n   x ${qty}  |  ${unit}  |  *${sub}*`;
    })
    : [];

  const out = [];

  // Solo agregar encabezado y lista si hay items
  if (list.length) {
    out.push('🧾 *Presupuesto*');
    out.push(...bulletLines);
    out.push('');
    out.push('*Totales*');
    out.push(`• Subtotal sin descuento: ${currencyFmt(tot.lista)}`);
    out.push(`• 💵 Total en efectivo (−${Math.round(env.discounts.cash * 100)}%): ${currencyFmt(tot.efectivo)}`);
    out.push('');
    out.push(validityLine());
    out.push(commandsHintLine());
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
