// src/controllers/wati/greetings.controller.js
// ----------------------------------------------------
import { GREETINGS, ensureSession, renderSummary, helpBudgetShort } from './utils.js';
import { getSession, bumpSession, getSnapshot } from '../../services/sessionService.js';
import { sendText, sendInteractiveButtons } from '../../services/watiService.js';
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

  // Si hay presupuesto activo, mostramos el estado + botones
  // PERO solo si tiene ITEMS VÁLIDOS. Si solo tiene pendientes (basura/no encontrados), mostramos menú principal.
  const hasItems = sess.items?.length > 0;

  if (sess.mode === 'BUDGET' && hasItems) {
    await bumpSession(phone);

    await sendText(
      phone,
      `${firstLine} Seguís con un *presupuesto abierto*. Te muestro el estado 👇\n\n` +
      renderSummary(sess.items, sess.notFound)
    );

    const buttons = [];
    if (sess.items.length > 0) {
      buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
    }
    buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

    await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    return true;
  }

  await sendInteractiveButtons(
    phone,
    '¿En qué puedo ayudarte?',
    [
      { id: 'presupuesto', title: '📋 Presupuesto' },
      { id: 'catalogo', title: '📚 Catálogo' }
    ]
  );
  return true;
}