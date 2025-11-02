// src/controllers/watiWebhookController.js
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { getSession, setSession, bumpSession, clearSession } from '../services/sessionService.js';
import { sendText, sendPdf } from '../services/watiService.js';
import { buildProductIndex } from '../services/shopifyService.js';
import { matchFromText } from '../services/matchService.js';
import { computeLineTotals, currency } from '../services/priceService.js';
import { generateBudgetPDF } from '../services/pdfService.js';

function menuText() {
  return [
    '*MENÚ*',
    'CATALOGO — ver productos y comprar directo',
    'PRESUPUESTO — activar modo presupuesto (texto / foto / audio)',
    '',
    'Respondé: CATALOGO / PRESUPUESTO / MENU'
  ].join('\n');
}

function helpBudget() {
  return [
    'Modo Presupuesto activado ✅',
    'Pasá tu lista por *texto*, *foto* (planilla) o *audio*.',
    'Comandos: *Agregar* / *Quitar* / *Cambiar* / *Ver* / *Confirmar* / *Cancelar*'
  ].join('\n');
}

function renderSummary(items = []) {
  const lines = items.map(i => `• ${i.title} × ${i.qty} — ${currency(i.amounts.lista)}`);
  const tot = items.reduce(
    (acc, i) => {
      acc.lista += i.amounts.lista;
      acc.transferencia += i.amounts.transferencia;
      acc.efectivo += i.amounts.efectivo;
      return acc;
    },
    { lista: 0, transferencia: 0, efectivo: 0 }
  );

  return [
    '*Presupuesto (provisorio)*',
    ...lines,
    '',
    '*Resumen de totales*',
    `• Total en efectivo (−${Math.round(env.discounts.cash * 100)}%): ${currency(tot.efectivo)}`,
    `• Total por transferencia (−${Math.round(env.discounts.transfer * 100)}%): ${currency(tot.transferencia)}`,
    `• Subtotal materiales (lista): ${currency(tot.lista)}`,
    '',
    `Validez: ${env.business.budgetValidityDays} día${env.business.budgetValidityDays > 1 ? 's' : ''}.`,
    'Acciones: Agregar / Quitar / Cambiar / Ver / Confirmar / Cancelar'
  ].join('\n');
}

export async function watiWebhookController(req, res) {
  // WATI body varía según tipo; tomamos phone y texto si están
  const body = req.body || {};
  const phone = body?.waId || body?.to || body?.from || 'unknown';
  const text = (body?.text || body?.message || '').toString().trim();

  logger.debug({ bodyPreview: JSON.stringify(body).slice(0, 500) }, 'WATI inbound');

  // Ack rápido a WATI
  res.status(200).json({ ok: true });

  if (!phone || phone === 'unknown') return;

  const t = text.toUpperCase();

  // Menú rápido
  if (['MENU', 'MENÚ', 'INICIO', 'HOLA'].includes(t)) {
    await sendText(phone, menuText());
    return;
  }

  // Entrada al modo presupuesto
  if (['PRESUPUESTO', 'PRESUPUESTOS'].includes(t)) {
    await setSession(phone, { mode: 'BUDGET', items: [], startedAt: Date.now() });
    await sendText(phone, helpBudget());
    return;
  }

  // CATALOGO: lo maneja WATI nativo
  if (['CATALOGO', 'CATÁLOGO'].includes(t)) {
    await sendText(phone, 'Abriendo catálogo…');
    return;
  }

  // Si el usuario está en modo presupuesto
  const sess = await getSession(phone);
  if (sess?.mode === 'BUDGET') {
    await bumpSession(phone);

    // Comandos básicos
    if (['VER', 'RESUMEN'].includes(t)) {
      await sendText(phone, renderSummary(sess.items));
      return;
    }

    if (['CANCELAR', 'SALIR'].includes(t)) {
      await clearSession(phone);
      await sendText(phone, 'Presupuesto cancelado. Podés escribir *PRESUPUESTO* para empezar de nuevo.');
      return;
    }

    if (['CONFIRMAR', 'CONFIRMADO', 'OK'].includes(t)) {
      if (!sess.items || sess.items.length === 0) {
        await sendText(phone, 'No hay ítems cargados. Enviá tu lista o escribí *Ver* para revisar.');
        return;
      }

      // Generar PDF
      const totals = sess.items.reduce(
        (acc, i) => {
          acc.lista += i.amounts.lista;
          acc.transferencia += i.amounts.transferencia;
          acc.efectivo += i.amounts.efectivo;
          return acc;
        },
        { lista: 0, transferencia: 0, efectivo: 0 }
      );

      const buffer = await generateBudgetPDF({
        items: sess.items.map(i => ({
          title: i.title,
          qty: i.qty,
          subtotalLista: currency(i.amounts.lista)
        })),
        totals,
        notFound: [], // en v2 agregamos "no encontrados"
        meta: { number: `P-${Date.now()}` }
      });

      const tmpPath = path.resolve('tmp', `presupuesto-${Date.now()}.pdf`);
      await fs.mkdir(path.dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, buffer);

      await sendPdf(phone, tmpPath, path.basename(tmpPath));
      await sendText(
        phone,
        [
          'Listo ✅ Te envié el *PDF* del presupuesto.',
          'Si necesitás modificar algo, escribí *PRESUPUESTO* para empezar uno nuevo.'
        ].join('\n')
      );

      // Mantener la sesión activa por si quiere ajustar; si preferís limpiar:
      // await clearSession(phone);
      return;
    }

    // (Stub) Quitar / Cambiar — se implementan con búsqueda por palabra clave
    if (t.startsWith('QUITAR ')) {
      const word = t.replace('QUITAR', '').trim().toLowerCase();
      const before = sess.items.length;
      sess.items = sess.items.filter(i => !i.title.toLowerCase().includes(word));
      await setSession(phone, sess);
      const diff = before - sess.items.length;
      await sendText(phone, diff > 0 ? `Quité ${diff} ítem(s).` : 'No encontré coincidencias para quitar.');
      return;
    }
    if (t.startsWith('CAMBIAR ')) {
      // Formato simple: CAMBIAR cemento x 10
      const m = /CAMBIAR\s+(.+)\s+x\s+(\d+)/i.exec(text);
      if (m) {
        const word = m[1].toLowerCase();
        const qty = Number(m[2]);
        let changed = 0;
        sess.items = sess.items.map(i => {
          if (i.title.toLowerCase().includes(word)) {
            changed++;
            const totals = computeLineTotals({ price: i.amounts.lista / i.qty }, qty); // reescala con precio unitario lista
            return {
              ...i,
              qty,
              amounts: {
                lista: totals.lista,
                transferencia: totals.transferencia,
                efectivo: totals.efectivo
              }
            };
          }
          return i;
        });
        await setSession(phone, sess);
        await sendText(phone, changed ? `Actualicé cantidades (${changed}).` : 'No encontré coincidencias para cambiar.');
        return;
      }
    }

    // Si no es comando, intentamos parsear/agregar desde texto libre
    const idx = await buildProductIndex();
    const candidates = await matchFromText(text, idx);

    if (!candidates.length) {
      await sendText(
        phone,
        'No pude reconocer ítems. Probá indicar *producto y cantidad*, por ejemplo: "cemento 10", "piedra 6/20 2 bolsón".'
      );
      return;
    }

    sess.items = sess.items || [];
    for (const c of candidates) {
      const totals = computeLineTotals(c.variant, c.qty);
      sess.items.push({
        productId: c.product.id,
        variantId: c.variant.id,
        title: `${c.product.title} ${c.variant.title !== 'Default Title' ? c.variant.title : ''}`.trim(),
        qty: c.qty,
        amounts: {
          lista: totals.lista,
          transferencia: totals.transferencia,
          efectivo: totals.efectivo
        }
      });
    }
    await setSession(phone, sess);

    await sendText(phone, renderSummary(sess.items));
    return;
  }

  // Default fuera del modo presupuesto
  await sendText(phone, menuText());
}
