// src/controllers/wati/greetings.controller.js
// ----------------------------------------------------
import { GREETINGS, ensureSession, renderSummary, helpBudgetShort } from './utils.js';
import { getSession, bumpSession, getSnapshot } from '../../services/sessionService.js';
import { sendText } from '../../services/watiService.js';
import { env } from '../../config/env.js';

function fmtExpiryFromSnap(snap) {
  const days = Number(env?.business?.budgetValidityDays ?? 1);
  const ts = snap?.expiresAt ?? (snap?.savedAt ? snap.savedAt + days * 24 * 60 * 60 * 1000 : null);
  try { return ts ? new Date(ts).toLocaleString('es-AR') : null; } catch { return null; }
}

export async function handleGreetingsOrCatalog({ phone, textNorm, name }) {
  const isCatalog = ['CATALOGO', 'CATÁLOGO', 'VER CATALOGO', 'VER CATÁLOGO'].includes(textNorm);
  const isGreeting = GREETINGS.has(textNorm);
  const isGreetingOrCatalog = isGreeting || isCatalog;

  if (!isGreetingOrCatalog) return false;

  const firstLine = name ? `¡Hola, *${name}*! 👋` : `¡Hola! 👋`;

  // 👉 Si es CATALOGO → dejamos que WATI maneje su plantilla
  if (isCatalog) return false;

  // 👉 Si es solo un saludo simple (HOLA, BUENOS DIAS, etc.) → dejamos que WATI responda primero
  // Solo respondemos si ya hay una sesión activa o snapshot
  const sess = ensureSession(await getSession(phone));
  const snap = await getSnapshot(phone);

  // Si hay presupuesto activo, mostramos el estado
  if (sess.mode === 'BUDGET') {
    await bumpSession(phone);
    const guide = !sess.items?.length ? '\n\n' + helpBudgetShort() : '';
    await sendText(
      phone,
      `${firstLine} Seguís con un *presupuesto abierto*. Te muestro el estado 👇\n\n` +
      renderSummary(sess.items, sess.notFound) + guide
    );
    return true;
  }

  // Si hay snapshot, ofrecemos continuar
  if (snap) {
    const when = fmtExpiryFromSnap(snap);
    await sendText(
      phone,
      `${firstLine} Tengo tu último presupuesto *${snap.number}* guardado` +
      (when ? ` (vigente hasta ${when})` : '') + `.\n` +
      `¿Querés *CONTINUAR* ese presupuesto o empezar uno *NUEVO*?\n\n` +
      'Tip: también podés mandar 📷 foto (planilla/lista) o 🎤 audio con tu pedido.'
    );
    return true;
  }

  // Si no hay sesión ni snapshot, NO respondemos al saludo simple
  // Dejamos que WATI maneje el primer contacto con su mensaje automático
  return false; // ← Esto hace que WATI responda
}