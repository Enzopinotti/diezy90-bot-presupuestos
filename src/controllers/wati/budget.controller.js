// src/controllers/wati/budget.controller.js
// ---------------------------------------------------
import fs from 'fs/promises';
import path from 'path';

import { env } from '../../config/env.js';
import { getSession, setSession, bumpSession, clearSession, saveSnapshot } from '../../services/sessionService.js';
import { sendText, sendPdf, sendInteractiveButtons, sendInteractiveList } from '../../services/watiService.js';
import { buildProductIndex } from '../../services/shopifyService.js';
import { computeLineTotals, currency as _currency } from '../../services/priceService.js';
import { generateBudgetPDF } from '../../services/pdfService.js';
import { transcribeAudio } from '../../services/sttService.js';
import { ocrImageToText } from '../../services/ocrService.js';
import { parseIntent } from '../../services/intentService.js';
import { smartMatch, humanizeName } from '../../services/matchService.js';
import {
  sanitizeText, splitLinesSmart, RESERVED_TOKENS, normalizeSpokenNumbers, isLikelyBudgetList
} from '../../services/textService.js';

import {
  renderSummary,
  mergeSameItems,
  helpBudgetShort,
} from './utils.js';

import { trackLastAction, resolveTargetRef, applyRelativeAdjust } from '../../services/contextService.js';
import { logUnknown, logNotFound } from '../../services/insightsService.js';
import { answerDelivery, answerHours, answerLocation, answerPayment, answerStockGeneric } from '../../services/commerceFaqService.js';

const GREETINGS = /\b(hola|buen dia|buenos dias|buenas|que tal|menu|men[uú]|inicio|start|hello|hi|ahola|holaa|holis)\b/i;
function currency(n) { return _currency(n); }

function formatPriceARS(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// YES/NO flexibles para confirmaciones (agrego variantes coloquiales y IDs de botones)
const YES_RE = /^(si|sí|dale|ok(ay)?|de una|va|joya|perfecto|okey|confirm_add_yes|confirm_cancel_yes)\b/i;
const NO_RE = /^(no|nop|nope|mejor no|dejalo|dejemoslo|más tarde|mas tarde|paso|no gracias|confirm_add_no|confirm_cancel_no|confirm_no)\b/i;

// ——— Helpers ———
function filterReserved(list = []) {
  return (list || []).filter(s => !RESERVED_TOKENS.has(String(s).toLowerCase()));
}

async function showCategory({ phone, term, qty = 1 }) {
  const idx = await buildProductIndex();
  const t = String(term || '').toLowerCase();
  const picks = idx.filter(p => p.title?.toLowerCase().includes(t)).slice(0, 6);
  if (!picks.length) {
    await sendText(phone, `No encontré productos para *${term}*. Podés decirme *precio de ${term}* o mandarme la lista.`);
    return { pendingSelect: null };
  }
  const options = [];
  picks.forEach((p, i) => {
    const v = p.variants?.[0];
    const baseTitle = `${p.title}${v && v.title && v.title !== 'Default Title' ? ` – ${v.title}` : ''}`;
    const label = `${i + 1}) ${humanizeName(baseTitle)}`;
    options.push({
      label,
      productId: p.id,
      variantId: v?.id || null,
      fullTitle: humanizeName(`${p.title} ${v?.title || ''}`.trim())
    });
  });
  const question = `Estos son algunos *${term}* que tenemos:\n` +
    options.map(o => `• ${o.label}`).join('\n') +
    `\n\nDecime el *número* (1-${options.length}) para sumarlo x ${qty}.`;
  await sendText(phone, question);
  return { pendingSelect: { purpose: 'add_from_list', options, qty } };
}

// ——— Pending resolvers adicionales ———
async function maybeResolveCancel({ phone, text, sess }) {
  if (!sess?.pendingCancel) return false;
  const t = String(text || '').trim();

  if (!YES_RE.test(t) && !NO_RE.test(t)) {
    return false;
  }

  if (NO_RE.test(t)) {
    sess.pendingCancel = null;
    await setSession(phone, sess);
    await sendText(phone, 'Perfecto, seguimos con tu presupuesto. Escribí *VER* para ver el estado.');
    return true;
  }

  // Sí → cancelar presupuesto
  sess.pendingCancel = null;
  await clearSession(phone);
  await sendText(phone, 'Presupuesto cancelado ✅.');
  await sendInteractiveButtons(phone, '¿En qué puedo ayudarte?', [
    { id: 'presupuesto', title: '📋 Presupuesto' },
    { id: 'catalogo', title: '📚 Catálogo' }
  ]);
  return true;
}

async function maybeResolveConfirmation({ phone, text, sess }) {
  if (!sess?.pendingConfirm) return false;
  const t = String(text || '').trim();
  if (!YES_RE.test(t) && !NO_RE.test(t)) return false;

  if (NO_RE.test(t)) {
    sess.pendingConfirm = null;
    await setSession(phone, sess);
    await sendText(phone, 'Listo, no lo sumo. Si querés ver cómo va quedando, escribí *VER*.');
    return true;
  }

  const { action, productId, variantId, qty } = sess.pendingConfirm || {};
  if (action === 'ADD' && productId) {
    const idx = await buildProductIndex();
    const product = idx.find(p => p.id === productId);
    const variant = product?.variants?.find(v => v.id === variantId) || product?.variants?.[0];
    if (product && variant) {
      const totals = computeLineTotals(variant, qty || 1);
      const baseTitle = `${product.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
      const title = humanizeName(baseTitle);

      sess.items.push({
        productId: product.id,
        variantId: variant.id,
        title,
        qty: qty || 1,
        amounts: { lista: totals.lista, transferencia: totals.transferencia, efectivo: totals.efectivo }
      });
      sess.items = mergeSameItems(sess.items);
      trackLastAction(sess, { index: sess.items.length - 1, productId: product.id, variantId: variant.id });
    }
  }
  sess.pendingConfirm = null;
  await setSession(phone, sess);
  await sendText(phone, renderSummary(sess.items, sess.notFound));
  return true;
}

// Helper para iniciar la fase de selección de variante/cantidad para un item específico
async function startEditForItem(phone, sess, itemIndex) {
  const item = sess.items[itemIndex];
  if (!item) {
    await sendText(phone, 'No encontré ese item. Intentá de nuevo.');
    sess.editMode = null;
    await setSession(phone, sess);
    return true;
  }

  const idx = await buildProductIndex();
  const product = idx.find(p => p.id === item.productId);

  if (!product) {
    await sendText(phone, 'No pude cargar las variantes de este producto.');
    sess.editMode = null;
    await setSession(phone, sess);
    return true;
  }

  const titleLower = product.title.toLowerCase();
  const categories = [
    'arena', 'cemento', 'piedra', 'cal', 'ladrillo', 'hierro', 'malla',
    'vigueta', 'escombro', 'tosca', 'plasticor', 'hidrofugo', 'pegamento',
    'ceramico', 'impermeabilizante', 'tapa', 'viga', 'columna', 'estribo',
    'alambre', 'clavo', 'tornillo', 'perfil', 'chapa'
  ];

  let baseKeywords = categories.filter(cat => titleLower.includes(cat));
  if (baseKeywords.length === 0) {
    let firstWord = titleLower.split(' ')[0].replace(/s$/, '');
    baseKeywords = firstWord.length > 3 ? [firstWord] : [titleLower.split(' ')[0]];
  }

  const relatedProducts = idx.filter(p => {
    const pTitle = p.title.toLowerCase();
    return baseKeywords.some(kw => pTitle.includes(kw)) && p.variants?.length > 0;
  });

  if (!relatedProducts.length) {
    await sendText(phone, 'No encontré productos relacionados para editar.');
    sess.editMode = null;
    await setSession(phone, sess);
    return true;
  }

  const allOptions = [];
  relatedProducts.forEach(prod => {
    prod.variants.forEach(v => {
      allOptions.push({
        productId: prod.id,
        variantId: v.id,
        title: humanizeName(`${prod.title} ${v.title !== 'Default Title' ? v.title : ''}`.trim()),
        price: v.price || 0
      });
    });
  });

  const limitedOptions = allOptions.slice(0, 10);
  const variantRows = limitedOptions.map((opt, optIdx) => ({
    id: `0-${optIdx}`,
    title: opt.title.substring(0, 24),
    description: currency(opt.price)
  }));

  sess.editMode = { stage: 'selecting_variant', itemIndex, options: limitedOptions };
  await setSession(phone, sess);

  await sendInteractiveList(
    phone,
    `Opciones de ${baseKeywords[0]?.toUpperCase() || 'PRODUCTO'}:`,
    'Ver opciones',
    [{ title: 'Productos disponibles', rows: variantRows }]
  );
  return true;
}

// Handler para edición de items
async function maybeResolveEditMode({ phone, text, sess }) {
  if (!sess?.editMode) return false;

  try {

    // Stage 1: Seleccionando qué item editar
    if (sess.editMode.stage === 'selecting_item') {
      console.log('✏️ [EDIT] text recibido:', text);
      console.log('✏️ [EDIT] sess.items:', JSON.stringify(sess.items?.map(i => i.title)));

      let itemIndex = -1;
      if (text.startsWith('edit_item_')) {
        itemIndex = parseInt(text.replace('edit_item_', ''));
      } else if (/^\d+-\d+$/.test(text.trim())) {
        const parts = text.trim().split('-');
        itemIndex = parseInt(parts[1]);
      } else if (/^\d+$/.test(text.trim())) {
        itemIndex = parseInt(text.trim()) - 1;
      } else {
        console.log('✏️ [EDIT] Texto no matchea ningún patrón:', text);
        await sendText(phone, 'No identifiqué el item. Por favor, seleccioná uno de la lista.');
        return true;
      }

      console.log('✏️ [EDIT] itemIndex parseado:', itemIndex);
      console.log('✏️ [EDIT] sess.items.length:', sess.items?.length);

      const item = sess.items[itemIndex];
      console.log('✏️ [EDIT] item encontrado:', item ? item.title : 'undefined');

      if (!item) {
        console.log('✏️ [EDIT] Item no encontrado en sess.items');
        await sendText(phone, 'No encontré ese item. Intentá de nuevo.');
        sess.editMode = null;
        await setSession(phone, sess);
        return true;
      }

      return await startEditForItem(phone, sess, itemIndex);
    }


    // Stage 2: Seleccionando variante/producto
    if (sess.editMode.stage === 'selecting_variant') {
      const itemIndex = sess.editMode.itemIndex;
      const options = sess.editMode.options || [];
      let optionIndex = -1;

      if (text.startsWith('edit_variant_')) {
        const parts = text.replace('edit_variant_', '').split('_');
        optionIndex = parseInt(parts[1]);
      } else if (/\b(cancel|cancelar|salir|confirm_no)\b/i.test(text)) {
        await sendText(phone, 'Edición cancelada. Volviendo al presupuesto...');
        sess.editMode = null;
        await setSession(phone, sess);
        await sendText(phone, renderSummary(sess.items, sess.notFound));
        return true;
      } else if (/^\d+-\d+$/.test(text.trim())) {
        const parts = text.trim().split('-');
        optionIndex = parseInt(parts[1]);
      } else if (/^\d+$/.test(text.trim())) {
        const val = parseInt(text.trim());
        // Si el número es un índice válido de la lista
        if (val >= 1 && val <= options.length) {
          optionIndex = val - 1;
        } else {
          // Si no es un índice, pero es un número solo, podría ser INTENCIÓN DE CAMBIO DE CANTIDAD
          console.log('✏️ [EDIT] El número no es un índice, probando como cantidad:', val);
          const item = sess.items[itemIndex];
          if (item && val > 0) {
            const oldQty = item.qty;
            item.qty = val;
            // Recalcular montos (asumimos que amounts.lista es precio unitario * qty)
            const unitPrice = item.amounts.lista / oldQty;
            item.amounts.lista = unitPrice * item.qty;

            await sendText(phone, `✅ Cantidad actualizada: *${item.qty}x ${item.title}*`);
            sess.editMode = null;
            await setSession(phone, sess);
            // Mostrar resumen actualizado
            await sendText(phone, renderSummary(sess.items, sess.notFound));
            return true;
          }
        }
      }

      // Si no fue un índice ni un cambio de cantidad simple, último intento de parsear frase de cantidad
      const qtyPhrase = text.match(/(?:quiero|son|cambia a|ponele)\s*(\d+)/i);
      if (qtyPhrase && optionIndex === -1) {
        const newQty = parseInt(qtyPhrase[1]);
        const item = sess.items[itemIndex];
        if (item && newQty > 0) {
          const oldQty = item.qty;
          item.qty = newQty;
          const unitPrice = item.amounts.lista / oldQty;
          item.amounts.lista = unitPrice * item.qty;

          await sendText(phone, `✅ Cantidad actualizada: *${item.qty}x ${item.title}*`);
          // Limpiar modo edición y refrescar total
          sess.editMode = null;
          await setSession(phone, sess);
          await sendText(phone, renderSummary(sess.items, sess.notFound));
          return true;
        }
      }

      if (optionIndex === -1) {
        await sendText(phone, 'No identifiqué la opción. Elegí un producto de la lista o escribí la nueva cantidad (ej: "10").');
        return true;
      }

      const selectedOption = options[optionIndex];
      if (!selectedOption) {
        await sendText(phone, 'No encontré esa opción. Intentá de nuevo.');
        sess.editMode = null;
        await setSession(phone, sess);
        return true;
      }

      const item = sess.items[itemIndex];
      const idx = await buildProductIndex();
      const newProduct = idx.find(p => p.id === selectedOption.productId);
      const newVariant = newProduct?.variants?.find(v => v.id === selectedOption.variantId);

      if (!newVariant) {
        await sendText(phone, 'No encontré ese producto. Intentá de nuevo.');
        sess.editMode = null;
        await setSession(phone, sess);
        return true;
      }

      // Actualizar item con nuevo producto/variante
      const totals = computeLineTotals(newVariant, item.qty);

      sess.items[itemIndex] = {
        ...item,
        productId: newProduct.id,
        variantId: newVariant.id,
        title: selectedOption.title,
        amounts: totals
      };
      sess.editMode = null;
      await setSession(phone, sess);

      await sendText(phone, `✅ Actualizado a *${selectedOption.title}*`);
      await sendText(phone, renderSummary(sess.items, sess.notFound));

      const buttons = [];
      if (sess.items.length > 0) {
        buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
        buttons.push({ id: 'edit', title: '✏️ Editar' });
      }
      buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });
      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ [EDIT] Error fatal en maybeResolveEditMode:', err);
    await sendText(phone, '⚠️ Ocurrió un error en el modo edición. Volviendo al presupuesto...');
    sess.editMode = null;
    await setSession(phone, sess);
    return false;
  }
}

async function maybeResolvePendingSelect({ phone, text, sess }) {
  // Si estamos en modo edición, NO procesar aquí
  if (sess?.editMode) return false;
  if (!sess?.pendingSelect) return false;
  const { purpose, options, qty } = sess.pendingSelect;
  let chosen = null;
  const n = Number(String(text).trim());

  if (String(text).startsWith('product_')) {
    chosen = options.find(o => o.id === text);
  } else if (/^\d+-\d+$/.test(String(text).trim())) {
    const parts = String(text).trim().split('-');
    const itemIdx = parseInt(parts[1]);
    if (itemIdx >= 0 && itemIdx < options.length) {
      chosen = options[itemIdx];
    }
  } else if (Number.isFinite(n) && n >= 1 && n <= options.length) {
    chosen = options[n - 1];
  } else {
    const t = String(text).toLowerCase();
    chosen = options.find(o => o.label?.toLowerCase().includes(t) || o.title?.toLowerCase().includes(t) || o.fullTitle?.toLowerCase().includes(t));
  }

  if (!chosen) {
    await sendText(phone, 'No reconocí la opción. Por favor, elegí de la lista.');
    return true;
  }

  const idx = await buildProductIndex();
  const product = idx.find(p => p.id === chosen.productId) || idx.find(p => p.title && chosen.fullTitle?.toLowerCase().includes(p.title.toLowerCase()));
  const variant = product?.variants?.find(v => v.id === chosen.variantId) || product?.variants?.[0];

  if (purpose === 'price') {
    if (product && variant) {
      const unit = Number(variant.price || 0);
      const baseTitle = `${product.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
      const title = humanizeName(baseTitle);

      await sendText(
        phone,
        `El *${title}* sale *${currency(unit)}* por unidad.`
      );

      await sendInteractiveButtons(
        phone,
        `¿Lo agrego x *${qty || 1}* al presupuesto?`,
        [
          { id: 'confirm_add_yes', title: '✅ Sí, agregar' },
          { id: 'confirm_add_no', title: '❌ No' }
        ]
      );

      sess.pendingConfirm = { action: 'ADD', productId: product.id, variantId: variant.id, qty: qty || 1 };
    }
    sess.pendingSelect = null;
    await setSession(phone, sess);
    return true;
  }

  if (purpose === 'add_from_list') {
    if (product && (!chosen.variantId || (product.variants?.length || 0) > 1)) {
      const vOpts = (product.variants || []).slice(0, 6).map((v, i) => ({
        label: `${i + 1}) ${v.title === 'Default Title' ? 'Presentación estándar' : v.title}`,
        productId: product.id,
        variantId: v.id,
        fullTitle: humanizeName(`${product.title} ${v.title}`.trim())
      }));
      sess.pendingSelect = { purpose: 'add_from_list', options: vOpts, qty: qty || 1 };
      await setSession(phone, sess);
      await sendText(
        phone,
        `Necesito que elijas la *presentación* de ${humanizeName(product.title)}:\n` +
        vOpts.map(o => `• ${o.label}`).join('\n') +
        `\n\nRespondé con el *número* (1-${vOpts.length}).`
      );
      return true;
    }
    sess.pendingSelect = null;
    await setSession(phone, sess);
    return true;
  }

  return false;
}

// Cola de aclaraciones para ADD (sess.pending.queue)
async function maybeResolvePending({ phone, text, sess }) {
  // Si estamos en modo edición, NO procesar aquí - dejar que el handler de edición lo maneje
  if (sess?.editMode) return false;
  if (!sess?.pending) return false;
  let { options, qty, queue = [] } = sess.pending;

  let chosen = null;

  // Detectar respuesta de lista interactiva (product_XXXXXX)
  if (String(text).startsWith('product_')) {
    chosen = options.find(o => o.id === text);
  } else if (/^\d+-\d+$/.test(String(text).trim())) {
    // Formato "0-2" de listas interactivas: sección-ítem
    const parts = String(text).trim().split('-');
    const itemIdx = parseInt(parts[1]);
    if (itemIdx >= 0 && itemIdx < options.length) {
      chosen = options[itemIdx];
    }
  } else {
    // Respuesta numérica tradicional
    const n = Number(String(text).trim());
    if (Number.isFinite(n) && n >= 1 && n <= options.length) {
      chosen = options[n - 1];
    } else {
      const t = String(text).toLowerCase();
      chosen = options.find(o => o.label?.toLowerCase().includes(t) || o.title?.toLowerCase().includes(t));
    }
  }

  if (!chosen) {
    await sendText(phone, `No reconocí la opción. Respondé con un número entre 1 y ${options.length}.`);
    return true;
  }

  const idx = await buildProductIndex();
  const product = idx.find(p => p.id === chosen.productId) ||
    idx.find(p => p.title && chosen.fullTitle?.toLowerCase().includes(p.title.toLowerCase()));
  const variant = product?.variants?.find(v => v.id === chosen.variantId) || product?.variants?.[0];

  if (product && variant) {
    const totals2 = computeLineTotals(variant, qty || 1);
    const baseTitle = `${product.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
    const title = humanizeName(baseTitle);

    // Feedback: agregando producto
    await sendText(phone, `✅ Agregando *${humanizeName(product.title)}* x ${qty || 1}...`);

    sess.items.push({
      productId: product.id,
      variantId: variant.id,
      title,
      qty: qty || 1,
      amounts: { lista: totals2.lista, transferencia: totals2.transferencia, efectivo: totals2.efectivo }
    });
    sess.items = mergeSameItems(sess.items);
    trackLastAction(sess, { index: sess.items.length - 1, productId: product.id, variantId: variant.id });
  }

  // Procesar siguiente item de la cola
  while (queue.length) {
    const [next, ...rest] = queue;

    // Si no hay opciones, saltear y agregar a notFound
    if (!next.options || next.options.length === 0) {
      // Extraer término del question para agregarlo a notFound
      const match = next.question?.match(/\*"([^"]+)"\*/);
      if (match) {
        sess.notFound.push(match[1]);
      }
      queue = rest;
      continue;
    }

    sess.pending = {
      question: next.question,
      options: next.options,
      qty: next.qty,
      queue: rest
    };
    await setSession(phone, sess);

    // Enviar lista interactiva (no solo texto)
    if (next.options.length <= 10) {
      await sendInteractiveList(
        phone,
        next.question,
        'Ver opciones',
        [{
          title: 'Productos',
          rows: next.options.map((opt, i) => ({
            id: `0-${i}`,
            title: opt.title,
            description: opt.description || ''
          }))
        }]
      );
    } else {
      // Fallback a texto si hay más de 10
      const questionLines = next.options.map((o, i) => `${i + 1}. *${o.title}*`);
      await sendText(phone, next.question + '\n\n' + questionLines.join('\n') + '\n\n👇 Respondé con el número');
    }
    return true;
  }

  sess.pending = null;
  await setSession(phone, sess);
  await sendText(phone, renderSummary(sess.items, sess.notFound));

  // Botones de acción tras mostrar resumen
  const buttons = [];
  if (sess.items.length > 0) {
    buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
    buttons.push({ id: 'edit', title: '✏️ Editar' });
  }
  buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

  await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
  return true;
}

// ——— Natural Language Editing ———

/**
 * Busca un item en el presupuesto actual usando matching fuzzy
 * @param {string} terms - Términos de búsqueda del usuario
 * @param {Array} items - Items actuales del presupuesto
 * @param {Array} productIndex - Índice de productos de Shopify
 * @returns {number|null} - Índice del item encontrado o null
 */
async function findItemInBudget(terms, items, productIndex) {
  if (!terms || !items?.length) return null;

  const { normalizeTerms } = await import('../../services/synonyms.js');
  const { correctSpelling } = await import('../../services/spellingCorrector.js');

  // Normalizar búsqueda
  const corrected = correctSpelling(terms);
  const normalized = normalizeTerms(corrected).toLowerCase();

  // Buscar coincidencia directa en títulos
  for (let i = 0; i < items.length; i++) {
    const itemTitle = normalizeTerms(items[i].title).toLowerCase();

    // Match exacto
    if (itemTitle.includes(normalized) || normalized.includes(itemTitle)) {
      return i;
    }

    // Match por palabras clave
    const searchWords = normalized.split(/\s+/).filter(w => w.length > 2);
    if (!searchWords.length) continue; // Evitar matches vacíos

    const titleWords = itemTitle.split(/\s+/);
    const matches = searchWords.filter(sw => titleWords.some(tw => tw.includes(sw) || sw.includes(tw)));

    // Extraer números de ambos
    const searchNums = normalized.match(/\d+/g) || [];
    const titleNums = itemTitle.match(/\d+/g) || [];
    const numMatch = searchNums.every(n => titleNums.includes(n));

    if (matches.length >= Math.min(2, searchWords.length) && numMatch) {
      return i;
    }
  }

  return null;
}

/**
 * Maneja comandos de edición natural (sacame, agregame, cambialo)
 */
async function handleNaturalEdit({ phone, intent, sess, productIndex }) {
  const { type, qty, terms } = intent;

  if (!sess.items?.length) {
    await sendText(phone, 'No tenés ningún presupuesto activo. Enviame una lista para empezar.');
    return true;
  }

  // REMOVE: "sacame 5 arenas" o "quitale el cemento"
  if (type === 'REMOVE') {
    if (!terms) {
      await sendText(phone, '¿Qué producto querés sacar? Ej: "sacame las arenas"');
      return true;
    }

    const itemIndex = await findItemInBudget(terms, sess.items, productIndex);

    if (itemIndex === null) {
      const itemsList = sess.items.map((it, i) => `${i + 1}. ${it.title} (${it.qty})`).join('\n');
      await sendText(
        phone,
        `No encontré "${terms}" en tu presupuesto.\n\nTenés:\n${itemsList}\n\n¿Querés sacar alguno de estos?`
      );
      return true;
    }

    const item = sess.items[itemIndex];

    // Si especificó cantidad, reducir
    if (qty && qty < item.qty) {
      item.qty -= qty;
      sess.items = mergeSameItems(sess.items);
      await setSession(phone, sess);

      await sendText(phone, `✅ Reduje *${item.title}* a ${item.qty} unidades`);
      await sendText(phone, renderSummary(sess.items, sess.notFound));

      const buttons = [
        { id: 'finalize', title: '✅ Finalizar (PDF)' },
        { id: 'edit', title: '✏️ Editar' },
        { id: 'confirm_no', title: '❌ Cancelar' }
      ];
      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
      return true;
    }

    // Eliminar completo
    sess.items.splice(itemIndex, 1);
    await setSession(phone, sess);

    await sendText(phone, `✅ Eliminé *${item.title}* del presupuesto`);

    if (sess.items.length === 0) {
      await sendText(phone, 'Tu presupuesto quedó vacío. Enviame una nueva lista cuando quieras.');
    } else {
      await sendText(phone, renderSummary(sess.items, sess.notFound));
      const buttons = [
        { id: 'finalize', title: '✅ Finalizar (PDF)' },
        { id: 'edit', title: '✏️ Editar' },
        { id: 'confirm_no', title: '❌ Cancelar' }
      ];
      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    }
    return true;
  }

  // ADD: "agregame 10 arenas" (aumentar si existe, agregar si no)
  if (type === 'ADD' && terms) {
    const itemIndex = await findItemInBudget(terms, sess.items, productIndex);

    // Si ya existe, aumentar cantidad
    if (itemIndex !== null) {
      const item = sess.items[itemIndex];
      const addQty = qty || 1;
      item.qty += addQty;
      sess.items = mergeSameItems(sess.items);
      await setSession(phone, sess);

      await sendText(phone, `✅ Aumenté *${item.title}* a ${item.qty} unidades`);
      await sendText(phone, renderSummary(sess.items, sess.notFound));

      const buttons = [
        { id: 'finalize', title: '✅ Finalizar (PDF)' },
        { id: 'edit', title: '✏️ Editar' },
        { id: 'confirm_no', title: '❌ Cancelar' }
      ];
      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
      return true;
    }

    // Si no existe, procesar como ADD normal (no manejamos aquí, retornar false)
    return false;
  }

  // CHANGE: "cambialo a 50"
  if (type === 'CHANGE') {
    if (!terms && sess.items.length === 1) {
      // Si solo hay un item, cambiar ese
      const item = sess.items[0];
      if (qty) {
        item.qty = qty;
        sess.items = mergeSameItems(sess.items);
        await setSession(phone, sess);

        await sendText(phone, `✅ Cambié *${item.title}* a ${qty} unidades`);
        await sendText(phone, renderSummary(sess.items, sess.notFound));

        const buttons = [
          { id: 'finalize', title: '✅ Finalizar (PDF)' },
          { id: 'edit', title: '✏️ Editar' },
          { id: 'confirm_no', title: '❌ Cancelar' }
        ];
        await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
        return true;
      }
    }

    if (terms) {
      const itemIndex = await findItemInBudget(terms, sess.items, productIndex);

      if (itemIndex === null) {
        const itemsList = sess.items.map((it, i) => `${i + 1}. ${it.title} (${it.qty})`).join('\n');
        await sendText(
          phone,
          `No encontré "${terms}" en tu presupuesto.\n\nTenés:\n${itemsList}`
        );
        return true;
      }

      const item = sess.items[itemIndex];
      if (qty) {
        item.qty = qty;
        sess.items = mergeSameItems(sess.items);
        await setSession(phone, sess);

        await sendText(phone, `✅ Cambié *${item.title}* a ${qty} unidades`);
        await sendText(phone, renderSummary(sess.items, sess.notFound));

        const buttons = [
          { id: 'finalize', title: '✅ Finalizar (PDF)' },
          { id: 'edit', title: '✏️ Editar' },
          { id: 'confirm_no', title: '❌ Cancelar' }
        ];
        await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
        return true;
      }
    }

    // Si no pudo determinar qué cambiar, mostrar lista
    const itemRows = sess.items.map((item, idx) => ({
      id: `edit_item_${idx}`,
      title: `${item.qty}x ${item.title.substring(0, 18)}`,
      description: currency(item.amounts.lista)
    }));

    await sendInteractiveList(
      phone,
      '¿Qué producto querés cambiar?',
      [{ title: 'Productos', rows: itemRows }]
    );

    // Activar modo edición para que el siguiente mensaje lo maneje
    sess.editMode = { stage: 'selecting_item' };
    await setSession(phone, sess);
    return true;
  }

  return false;
}

// ——— Public ———
export async function startBudget({ phone, silent = false }) {
  await setSession(phone, {
    mode: 'BUDGET',
    items: [],
    notFound: [],
    pending: null,
    pendingSelect: null,
    pendingConfirm: null,
    pendingCancel: null,
    startedAt: Date.now(),
    lastAction: null,
    unknownCount: 0
  });

  if (silent) return;

  await sendText(
    phone,
    [
      '🧱 *Modo Presupuesto activado* ✅',
      '',
      'Enviame tu lista de materiales.',
      '',
      helpBudgetShort()
    ].join('\n')
  );
}

export async function handleBudgetMessage(req, body, phone) {
  const text = (body.text || '').trim();
  let sess = await getSession(phone);

  // Parsear intención
  const intent = parseIntent(text);
  console.log('🧠 [BUDGET] Intent detectado:', intent);

  // Media → STT / OCR con feedback visual
  if (Array.isArray(req.files) && req.files.length) {
    for (const f of req.files) {
      try {
        if (f.mimetype?.startsWith?.('audio/')) {
          // Feedback: procesando audio
          await sendText(phone, '🎤 Escuchando tu audio...');
          const heard = await transcribeAudio(f.path);
          if (heard) {
            await sendText(phone, `✅ Escuché: "${heard}"`);
            text += `\n${heard}`;
          } else {
            await sendText(phone, '❌ No pude escuchar el audio. Intentá de nuevo o escribí tu lista.');
          }
        } else if (f.mimetype?.startsWith?.('image/')) {
          // Feedback: procesando imagen
          await sendText(phone, '📷 Leyendo tu foto...');
          const seen = await ocrImageToText(f.path);
          if (seen) {
            await sendText(phone, '✅ Foto leída correctamente');
            text += `\n${seen}`;
          } else {
            await sendText(phone, '❌ No pude leer la foto. Asegurate que sea nítida e intentá de nuevo.');
          }
        }
      } catch (err) {
        req?.log?.error?.({ err }, 'Media processing error');
      }
    }
  }

  let T = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();

  // 🔒 CATALOGO → lo maneja WATI
  if (T === 'CATALOGO' || T === 'CATÁLOGO' || T === 'VER CATALOGO' || T === 'VER CATALOGO.' || T === 'VER CATÁLOGO') {
    return;
  }

  if (!sess) {
    sess = {
      mode: 'BUDGET',
      items: [],
      notFound: [],
      pending: null,
      pendingSelect: null,
      pendingConfirm: null,
      pendingCancel: null,
      startedAt: Date.now(),
      lastAction: null,
      unknownCount: 0
    };
  } else {
    sess.unknownCount ??= 0;
    if (sess.pendingSelect === undefined) sess.pendingSelect = null;
    if (sess.pendingConfirm === undefined) sess.pendingConfirm = null;
    if (sess.pendingCancel === undefined) sess.pendingCancel = null;
    if (sess.lastAction === undefined) sess.lastAction = null;
  }
  await bumpSession(phone);

  // Si parece una lista de presupuesto NUEVA, RESET COMPLETO de sesión
  // para evitar confusión con estados pendientes o items anteriores
  // PERO: NO resetear si estamos en modo edición
  if (isLikelyBudgetList(text) && !['CANCEL', 'CONFIRM', 'EXIT_HINT', 'HUMAN', 'EDIT'].includes(intent.type) && !sess.editMode) {
    console.log('📋 [BUDGET] Lista detectada - RESET completo de sesión');

    // Limpiar TODO para procesar lista fresca
    sess.items = [];
    sess.notFound = [];
    sess.pending = null;
    sess.pendingSelect = null;
    sess.pendingCancel = null;
    sess.pendingConfirm = null;

    intent.type = 'ADD';
    intent.qty = 1;
  }

  // —— EDIT MODE tiene prioridad absoluta ——
  console.log('📝 [DEBUG] sess.editMode:', JSON.stringify(sess?.editMode));
  if (sess.editMode) {
    console.log('✏️ [EDIT] Entrando a maybeResolveEditMode con stage:', sess.editMode.stage);
    const handled = await maybeResolveEditMode({ phone, text, sess });
    console.log('✏️ [EDIT] maybeResolveEditMode retornó:', handled);
    if (handled) return;
  }

  // —— Resoluciones prioritarias ——
  if (await maybeResolveCancel({ phone, text, sess })) return;
  if (await maybeResolveConfirmation({ phone, text, sess })) return;
  if (await maybeResolvePendingSelect({ phone, text, sess })) return;
  if (await maybeResolvePending({ phone, text, sess })) return;

  // —— EDICIÓN NATURAL (auto-detección) ——
  // Si hay presupuesto activo y el intent es REMOVE/ADD/CHANGE, procesar automáticamente
  if (sess.items?.length > 0 && ['REMOVE', 'ADD', 'CHANGE'].includes(intent.type)) {
    const productIndex = await buildProductIndex();
    const handled = await handleNaturalEdit({ phone, intent, sess, productIndex });
    if (handled) return;
    // Si retorna false, continuar con flujo normal (ej: ADD de producto nuevo)
  }

  // Saludo en presupuesto (SOLO si no parece una lista)
  if (GREETINGS.test(text) && !isLikelyBudgetList(text)) {
    await setSession(phone, sess);
    const intro = sess.items?.length
      ? 'Seguimos con tu presupuesto. Acá va el estado 👇'
      : 'Modo Presupuesto activo ✅. Podés mandar texto, 📷 foto (planilla/lista) o 🎤 audio.';
    await sendText(phone, intro + '\n\n' + renderSummary(sess.items, sess.notFound));
    return;
  }

  if (intent.type === 'EXIT_HINT') { await sendText(phone, 'Para finalizar escribí *CANCELAR*.'); return; }

  // CANCEL
  if (intent.type === 'CANCEL') {
    T = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
    if (/\bCANCELAR\s+SI\b/.test(T)) {
      await clearSession(phone);
      await sendText(phone, 'Presupuesto cancelado ✅.');
      await sendInteractiveButtons(phone, '¿En qué puedo ayudarte?', [
        { id: 'presupuesto', title: '📋 Presupuesto' },
        { id: 'catalogo', title: '📚 Catálogo' }
      ]);
      return;
    }
    sess.pendingCancel = { at: Date.now() };
    await setSession(phone, sess);
    await sendInteractiveButtons(phone, '¿Confirmás cancelar el presupuesto?', [
      { id: 'cancel_yes', title: '✅ Sí, cancelar' },
      { id: 'cancel_no', title: '❌ No, seguir' }
    ]);
    return;
  }

  if (intent.type === 'HUMAN') { await sendText(phone, 'Listo, te derivo con un *asesor humano*.'); return; }

  // FAQs
  if (intent.type === 'FAQ_HOURS') { await sendText(phone, answerHours()); return; }
  if (intent.type === 'FAQ_LOCATION') { await sendText(phone, answerLocation()); return; }
  if (intent.type === 'FAQ_PAYMENT') { await sendText(phone, answerPayment()); return; }
  if (intent.type === 'FAQ_DELIVERY') { await sendText(phone, answerDelivery(text)); return; }
  if (intent.type === 'FAQ_STOCK') { await sendText(phone, answerStockGeneric(intent.terms || '')); return; }

  // Relative adjustments
  if (['REL_ADD', 'REL_SUB', 'REL_DOUBLE', 'REL_HALF'].includes(intent.type)) {
    const targetIndex = resolveTargetRef(intent.targetText || text, sess.items, sess.lastAction);
    const op = intent.type === 'REL_ADD' ? 'ADD' :
      intent.type === 'REL_SUB' ? 'SUB' :
        intent.type === 'REL_DOUBLE' ? 'DOUBLE' : 'HALF';
    const { changed } = applyRelativeAdjust(sess, { targetIndex, op, qty: intent.qty || null });
    await setSession(phone, sess);
    if (!changed) { await sendText(phone, 'No pude identificar el ítem. Escribí *VER* para ver la lista con números.'); return; }
    await sendText(phone, renderSummary(sess.items, sess.notFound));

    const buttons = [];
    if (sess.items.length > 0) {
      buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
      buttons.push({ id: 'edit', title: '✏️ Editar' });
    }
    buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

    await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    return;
  }

  // PRICE
  if (intent.type === 'PRICE' && intent.terms) {
    // Feedback: buscando precio
    await sendText(phone, `Buscando precio de *${intent.terms}*... 🔍`);

    const idx = await buildProductIndex();
    const clean = sanitizeText(intent.terms);
    const matchs = [...clean.matchAll(/\b(?:x|por|a)\s*(\d+(?:[.,]\d+)?)\b/g)];
    const lineQty = matchs.length
      ? Number(String(matchs[matchs.length - 1][1]).replace(',', '.'))
      : (intent.qty || 1);

    const r = await smartMatch(clean, idx, lineQty);

    if (!r.accepted.length && !r.clarify.length) {
      await sendText(
        phone,
        `No encontré "${clean}" en nuestro catálogo 😕\n\n` +
        `Podés:\n` +
        `• Intentar con otro nombre (ej: "cemento" en vez de "cemento portland")\n` +
        `• Mandarme una 📷 foto de tu lista\n` +
        `• Escribir "ASESOR" para hablar con una persona`
      );
      await logNotFound({ phone, terms: [clean] });
      return;
    }

    if (r.clarify.length) {
      const q = r.clarify[0];
      sess.pendingSelect = { purpose: 'price', options: q.options, qty: q.qty || intent.qty || 1 };
      await setSession(phone, sess);
      await sendText(phone, q.question);
      return;
    }

    const ac = r.accepted[0];
    const unit = Number(ac.variant.price || 0);
    const baseTitle = `${ac.product.title} ${ac.variant.title !== 'Default Title' ? ac.variant.title : ''}`.trim();
    const title = humanizeName(baseTitle);

    await sendText(
      phone,
      `El *${title}* sale *${currency(unit)}* por unidad.`
    );

    await sendInteractiveButtons(
      phone,
      `¿Lo agrego x *${ac.qty || intent.qty || 1}* al presupuesto?`,
      [
        { id: 'confirm_add_yes', title: '✅ Sí, agregar' },
        { id: 'confirm_add_no', title: '❌ No' }
      ]
    );

    sess.pendingConfirm = { action: 'ADD', productId: ac.product.id, variantId: ac.variant.id, qty: ac.qty || intent.qty || 1 };
    await setSession(phone, sess);
    return;
  }

  // LIST_CATEGORY
  if (intent.type === 'LIST_CATEGORY') {
    const { pendingSelect } = await showCategory({ phone, term: intent.term, qty: 1 });
    if (pendingSelect) {
      sess.pendingSelect = pendingSelect;
      await setSession(phone, sess);
    }
    return;
  }

  // CONFIRM (PDF)
  if (intent.type === 'CONFIRM') {
    if (!sess.items?.length) {
      await sendText(phone, 'No hay ítems cargados. Enviá tu lista (texto/📷/🎤).');
      return;
    }

    const totals = sess.items.reduce((a, i) => ({
      lista: a.lista + i.amounts.lista,
      efectivo: a.efectivo + i.amounts.efectivo
    }), { lista: 0, efectivo: 0 });

    try {
      const number = `P-${Date.now()}`;

      // Feedback mientras se genera el PDF (mensajes variados)
      const pdfMessages = [
        'Generando tu presupuesto en PDF… 📄✨',
        'Preparando el documento… 📋🔨',
        'Armando tu presupuesto… 📄💼'
      ];
      const randomPdfMsg = pdfMessages[Math.floor(Math.random() * pdfMessages.length)];
      await sendText(phone, randomPdfMsg);

      const buffer = await generateBudgetPDF({
        items: sess.items.map(i => ({
          title: i.title,
          qty: i.qty,
          subtotalLista: currency(i.amounts.lista)
        })),
        totals: {
          subtotalLista: currency(totals.lista),
          totalCash: currency(totals.efectivo),
          pctCash: `${Math.round(env.discounts.cash * 100)}%`
        },
        notFound: filterReserved(sess.notFound),
        meta: { number }
      });

      const tmpPath = path.resolve('tmp', `presupuesto-${Date.now()}.pdf`);
      await fs.mkdir(path.dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, buffer);

      await sendPdf(phone, tmpPath, path.basename(tmpPath));
      await sendText(phone, 'Listo ✅ Te envié el *PDF* del presupuesto.');

      // Volver al menú principal con botones
      await sendInteractiveButtons(phone, '¿En qué más te puedo ayudar?', [
        { id: 'presupuesto', title: '📝 Nuevo Presupuesto' },
        { id: 'catalogo', title: '📦 Ver Catálogo' }
      ]);

      const resume = {
        number,
        items: sess.items.map(i => ({ title: i.title, qty: i.qty })),
        notFound: filterReserved(sess.notFound),
        totals: {
          subtotalLista: currency(totals.lista),
          totalCash: currency(totals.efectivo),
          pctCash: `${Math.round(env.discounts.cash * 100)}%`
        }
      };

      await clearSession(phone);
      return;

    } catch (err) {
      req?.log?.error?.({ err }, 'PDF generation failed');
      await sendText(
        phone,
        'Hubo un error al generar el PDF. Intentá de nuevo o contactá al soporte.'
      );
    }
    return;
  }

  // EDIT - Editar items del presupuesto
  if (intent.type === 'EDIT') {
    if (!sess.items?.length) {
      await sendText(phone, 'No hay ítems para editar. Enviá tu lista primero.');
      return;
    }

    // Atajo: si hay un solo producto, ir directo a editarlo
    if (sess.items.length === 1) {
      return await startEditForItem(phone, sess, 0);
    }

    // Mostrar lista de items para que elija cuál editar
    const itemRows = sess.items.map((item, idx) => ({
      id: `edit_item_${idx}`,
      title: `${item.qty}x ${item.title.substring(0, 18)}`,
      description: currency(item.amounts.lista)
    }));

    sess.editMode = { stage: 'selecting_item' };
    await setSession(phone, sess);

    await sendInteractiveList(
      phone,
      `Tenés ${sess.items.length} productos. ¿Cuál querés modificar?`,
      'Ver productos',
      [{
        title: 'Items del presupuesto',
        rows: itemRows
      }]
    );
    return;
  }

  // NOTE: editMode handlers ahora están en maybeResolveEditMode() que se llama antes

  // REMOVE_INDEX
  if (intent.type === 'REMOVE_INDEX' && sess.items.length) {
    const idx = intent.index - 1;
    if (idx >= 0 && idx < sess.items.length) {
      sess.items.splice(idx, 1);
      sess.items = mergeSameItems(sess.items);
      await setSession(phone, sess);
      await sendText(phone, renderSummary(sess.items, sess.notFound));

      const buttons = [];
      if (sess.items.length > 0) {
        buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
        buttons.push({ id: 'edit', title: '✏️ Editar' });
      }
      buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    } else {
      await sendText(phone, 'Número inválido. Escribí *VER* para ver la lista con números.');
    }
    return;
  }

  // CHANGE_INDEX
  if (intent.type === 'CHANGE_INDEX' && sess.items.length) {
    const idx = intent.index - 1;
    const qty = Number(intent.qty);
    if (idx >= 0 && idx < sess.items.length && qty > 0) {
      if (qty > 1000) { await sendText(phone, `¿Seguro querés *${qty}* unidades? Si sí, repetilo con “CONFIRMAR ${idx + 1} x ${qty}”.`); return; }
      const it = sess.items[idx];
      const unit = it.amounts.lista / Math.max(it.qty, 1);
      const totals = computeLineTotals({ price: unit }, qty);
      sess.items[idx] = { ...it, qty, amounts: totals };
      trackLastAction(sess, { index: idx, productId: it.productId, variantId: it.variantId });
      await setSession(phone, sess);
      await sendText(phone, renderSummary(sess.items, sess.notFound));

      const buttons = [];
      if (sess.items.length > 0) {
        buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
        buttons.push({ id: 'edit', title: '✏️ Editar' });
      }
      buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

      await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    } else {
      await sendText(phone, 'Formato inválido. Ej: CAMBIAR 2 x 5');
    }
    return;
  }

  // REMOVE
  if (intent.type === 'REMOVE' && intent.terms) {
    const term = intent.terms.toLowerCase();
    const before = sess.items.length;
    sess.items = sess.items.filter(i => !i.title.toLowerCase().includes(term));
    if (before === sess.items.length) { await sendText(phone, 'No encontré qué quitar. Escribí *VER* para ver la lista con números.'); return; }
    sess.items = mergeSameItems(sess.items);
    await setSession(phone, sess);
    await sendText(phone, renderSummary(sess.items, sess.notFound));

    const buttons = [];
    if (sess.items.length > 0) {
      buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
      buttons.push({ id: 'edit', title: '✏️ Editar' });
    }
    buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

    await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    return;
  }

  // CHANGE
  if (intent.type === 'CHANGE' && intent.terms && intent.qty) {
    if (intent.qty > 1000) { await sendText(phone, `¿Seguro querés *${intent.qty}* unidades? Si sí, repetilo con “cambiá ${intent.terms} a ${intent.qty} (confirmo)”.`); return; }
    const term = intent.terms.toLowerCase();
    let changed = 0;
    sess.items = sess.items.map(i => {
      if (i.title.toLowerCase().includes(term)) {
        changed++;
        const unit = i.amounts.lista / Math.max(i.qty, 1);
        const totals = computeLineTotals({ price: unit }, intent.qty);
        return { ...i, qty: intent.qty, amounts: totals };
      }
      return i;
    });
    if (!changed) { await sendText(phone, 'No encontré qué cambiar. Probá: "cambiá cemento a 5".'); return; }
    sess.items = mergeSameItems(sess.items);
    await setSession(phone, sess);
    await sendText(phone, renderSummary(sess.items, sess.notFound));
    await sendInteractiveButtons(phone, '¿Qué querés hacer?', [
      { id: 'finalize', title: '✅ Finalizar (PDF)' },
      { id: 'confirm_no', title: '❌ Cancelar' }
    ]);
    return;
  }

  // REMOVE_LAST
  if (intent.type === 'REMOVE_LAST' && sess.items.length) {
    sess.items.pop();
    sess.items = mergeSameItems(sess.items);
    await setSession(phone, sess);
    await sendText(phone, renderSummary(sess.items, sess.notFound));

    const buttons = [];
    if (sess.items.length > 0) {
      buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
      buttons.push({ id: 'edit', title: '✏️ Editar' });
    }
    buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

    await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    return;
  }

  // ADD
  if (intent.type === 'ADD') {
    const idx = await buildProductIndex();

    // Normalizar números hablados (tres -> 3) para mejorar split y detección
    const normalizedText = normalizeSpokenNumbers(text);
    console.log('📝 [BUDGET] Texto normalizado:', normalizedText);

    const rawLines = splitLinesSmart(normalizedText);
    console.log('📝 [BUDGET] Líneas detectadas:', rawLines);

    const notFound = [];
    const clarify = [];

    if (rawLines.length >= 3) {
      await sendText(phone, 'Estoy leyendo tu lista y buscando productos en el catálogo… 🧱🔍');
    }

    const IGNORE_PHRASES = [
      'hola buenas tardes', 'hola buen dia', 'hola buenos dias', 'hola buenas noches',
      'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia',
      'hola', 'buenas', 'buenos', 'saludos', 'gracias', 'muchas gracias', 'por favor',
      'quisiera', 'me gustaria', 'necesito', 'quiero', 'precio', 'presupuesto',
      'que tal', 'como va', 'como estas', 'como andas',
      'ahola', 'holaa', 'holis', 'ordenar', 'pedir', 'dias'
    ].sort((a, b) => b.length - a.length); // Ordenar por longitud para matchear las largas primero

    const IGNORE_SUFFIXES = [
      'por favor', 'gracias', 'muchas gracias', 'para hacer un presupuesto', 'para hacer 1 presupuesto',
      'para el presupuesto', 'para mi casa', 'para la obra', 'presupuesto', 'saludos'
    ].sort((a, b) => b.length - a.length);

    const isMultiLine = rawLines.length >= 2;

    for (const line of rawLines) {
      let clean = sanitizeText(line);
      if (!clean) continue;

      // —— EDICIÓN NATURAL POR LÍNEA ——
      // Solo si NO estamos procesando una lista completa (isMultiLine)
      // para evitar que items nuevos se confundan con ediciones de items recién agregados
      const lineIntent = parseIntent(line);
      if (!isMultiLine && sess.items?.length > 0 && ['REMOVE', 'ADD', 'CHANGE'].includes(lineIntent.type)) {
        console.log(`✏️ [BUDGET] Detectada edición en línea: "${line}" -> Intent:`, lineIntent.type);
        const handled = await handleNaturalEdit({ phone, intent: lineIntent, sess, productIndex: idx });
        if (handled) continue;
      }

      // 0. Limpiar puntuación y espacios al inicio
      clean = clean.replace(/^[,.\-:;\s]+/, '').trim();

      // 1. Limpiar frases de inicio (prefijos)
      let changed = true;
      while (changed) {
        changed = false;
        for (const phrase of IGNORE_PHRASES) {
          // Chequear si empieza con la frase seguida de espacio o es la frase exacta
          if (clean === phrase || clean.startsWith(phrase + ' ') || clean.startsWith(phrase + ',')) {
            clean = clean.substring(phrase.length).trim();
            // Limpiar puntuación que quedó al inicio
            clean = clean.replace(/^[,.\-:;\s]+/, '').trim();
            changed = true;
            break; // Reiniciar loop de frases con el nuevo string limpio
          }
        }
      }

      // 2. Limpiar frases de final (sufijos)
      changed = true;
      while (changed) {
        changed = false;
        for (const phrase of IGNORE_SUFFIXES) {
          if (clean.endsWith(' ' + phrase) || clean === phrase) {
            clean = clean.substring(0, clean.length - phrase.length).trim();
            changed = true;
            break;
          }
        }
      }

      if (!clean) continue; // Si quedó vacío, era solo saludo

      // Ignorar líneas muy cortas que no parecen productos (ej: "si", "no", "ok")
      if (clean.length < 3) continue;

      // -------- Cantidad por línea (3 niveles de detección) --------
      // 1) "x 3", "por 3", "a 3"
      const qtyMatches = [...clean.matchAll(/\b(?:x|por|a)\s*(\d+(?:[.,]\d+)?)\b/gi)];
      let lineQty;

      if (qtyMatches.length) {
        lineQty = Number(String(qtyMatches[qtyMatches.length - 1][1]).replace(',', '.'));
      } else {
        // 2) Prefijo numérico: "2 arena", "- 2 arena", "• 3 cemento", "3 de arena"
        const prefixMatch = clean.match(/^\s*(?:[-*•]\s*)?(\d+(?:[.,]\d+)?)\b/);
        if (prefixMatch) {
          lineQty = Number(String(prefixMatch[1]).replace(',', '.'));
          // Quitar el número del string para buscar mejor
          // ej: "3 de arena" -> "de arena" -> "arena"
          clean = clean.substring(prefixMatch[0].length).trim();
        } else {
          // 3) Fallback: usar el qty detectado por el intent de la línea o 1
          lineQty = lineIntent.qty || 1;
        }
      }

      // Limpieza final de preposiciones (de, del) para todos los casos
      clean = clean.replace(/^(de|del)\s+/i, '');

      // Si después de limpiar todo quedó vacío o es una palabra ignorada (ej: gracias), saltar
      if (!clean || IGNORE_PHRASES.includes(clean)) {
        console.log(`⏩ [BUDGET] Saltando línea vacía o irrelevante: "${line}"`);
        continue;
      }

      console.log(`🔍 [BUDGET] Procesando línea: "${clean}" con cantidad: ${lineQty}`);
      const r = await smartMatch(clean, idx, lineQty);

      const nf = r.notFound.filter(s => !RESERVED_TOKENS.has(sanitizeText(s).toLowerCase()));
      notFound.push(...nf);


      if (r.accepted.length === 0 && r.clarify.length > 0) {
        clarify.push(...r.clarify);
      }

      for (const ac of r.accepted) {
        const totals = computeLineTotals(ac.variant, ac.qty);
        const baseTitle = `${ac.product.title} ${ac.variant.title !== 'Default Title' ? ac.variant.title : ''}`.trim();
        const title = humanizeName(baseTitle);

        sess.items.push({
          productId: ac.product.id,
          variantId: ac.variant.id,
          title,
          qty: ac.qty,
          amounts: { lista: totals.lista, transferencia: totals.transferencia, efectivo: totals.efectivo }
        });
        trackLastAction(sess, { index: sess.items.length - 1, productId: ac.product.id, variantId: ac.variant.id });
      }
    }

    sess.notFound = Array.from(new Set([...(sess.notFound || []), ...notFound]));
    sess.items = mergeSameItems(sess.items);

    // IMPORTANTE: Si hay items aceptados Y clarificaciones pendientes,
    // mostrar primero lo que se procesó correctamente
    if (sess.items.length > 0 && clarify.length > 0) {
      const acceptedList = sess.items.map(it => `✅ *${it.qty}x ${it.title}*`).join('\n');
      await setSession(phone, sess);
      await sendText(phone, `Agregué estos productos:\n\n${acceptedList}\n\nAhora necesito que me aclares unos detalles más... 👇`);
    }

    if (clarify.length) {
      const [first, ...rest] = clarify;
      sess.pending = {
        question: first.question,
        options: first.options,
        qty: first.qty,
        queue: rest
      };
      await setSession(phone, sess);

      // Usar lista interactiva si hay 10 o menos opciones
      if (first.useInteractiveList && first.options.length <= 10) {
        await sendInteractiveList(
          phone,
          first.question,
          'Ver opciones',
          [{
            title: 'Productos',
            rows: first.options.map(opt => ({
              id: opt.id,
              title: opt.title,
              description: opt.description
            }))
          }]
        );
      } else {
        // Fallback a texto numerado si son más de 10
        const questionLines = first.options.map((o, i) => {
          const priceStr = o.price != null ? `\n   $ ${formatPriceARS(o.price)}` : '';
          return `${i + 1}. *${o.title}*${priceStr}`;
        });
        await sendText(
          phone,
          `${first.question}\n\n` +
          questionLines.join('\n\n') +
          `\n\n👇 Respondé con el número de la opción correcta`
        );
      }
      return;
    }

    await setSession(phone, sess);
    await sendText(phone, renderSummary(sess.items, sess.notFound));

    // Botones: Finalizar, Editar (si hay items), Cancelar
    const buttons = [];
    if (sess.items.length > 0) {
      buttons.push({ id: 'finalize', title: '✅ Finalizar (PDF)' });
      buttons.push({ id: 'edit', title: '✏️ Editar' });
    }
    buttons.push({ id: 'confirm_no', title: '❌ Cancelar' });

    await sendInteractiveButtons(phone, '¿Qué querés hacer?', buttons);
    return;
  }

  // UNKNOWN
  sess.unknownCount++;
  await setSession(phone, sess);
  await logUnknown({ phone, text, mode: 'BUDGET' });

  if (sess.items?.length) {
    // Tiene items - mostrar resumen y opciones
    await sendText(
      phone,
      `No te entendí 🤔\n\nPodés seguir agregando productos o elegir una opción.`
    );
    await sendInteractiveButtons(phone, '¿Qué querés hacer?', [
      { id: 'finalize', title: '✅ Finalizar (PDF)' },
      { id: 'edit', title: '✏️ Editar' },
      { id: 'confirm_no', title: '❌ Cancelar' }
    ]);
  } else {
    // Sin items - dar instrucciones claras
    await sendText(
      phone,
      'No te entendí 🤔\n\n' +
      'Enviame tu lista de materiales por *texto*, *foto* 📷 o *audio* 🎤.\n\n' +
      '*Ejemplo:* 2 bolsones de arena, 4 bolsas de cemento, 1 piedra'
    );
  }

  if (sess.unknownCount >= 3) {
    await sendText(phone, '💬 Si preferís, te contacto con un asesor. Escribí *ASESOR* 👤.');
  }
}
