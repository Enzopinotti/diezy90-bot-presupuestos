// src/services/commerceFaqService.js
// ----------------------------------------------------
// Respuestas comerciales periféricas (stock/horarios/envíos/pagos)
// Pueden conectarse a APIs reales después; ahora son plantillas.

import { env } from '../config/env.js';
import { parseAddress, formatAddressParsed } from './addressService.js';

export function answerHours() {
  // Ajustá acá tus horarios reales
  return [
    '🕒 *Horarios*',
    'Lunes a Viernes: 8:00–12:30 y 14:30–18:30',
    'Sábados: 8:30–13:00',
    'Domingos: cerrado',
  ].join('\n');
}

export function answerLocation() {
  // Ajustá con tu ubicación real
  return [
    '📍 *Ubicación*',
    'Vista Diez y 90 Corralón',
    'Calle 90 N° 757 esq. 10 – La Plata',
    'Tel: 221-4516849 | WhatsApp: 221-5064398'
  ].join('\n');
}

export function answerPayment() {
  const cashPct = Math.round((env.discounts?.cash ?? 0.10) * 100);
  return [
    '💳 *Medios de pago*',
    `• Efectivo: ${cashPct}% off sobre lista`,
    '• Transferencia',
    '• Mercado Pago (consultar condiciones vigentes)',
  ].join('\n');
}

export function answerStockGeneric(query = '') {
  // Si querés, conectá con Shopify inventory_levels
  return [
    '📦 *Stock*',
    'Manejamos stock dinámico. Decinos el producto y cantidad, y te confirmamos disponibilidad pronto.',
    query ? `Consulta: ${query}` : ''
  ].filter(Boolean).join('\n');
}

export function answerDelivery(text = '') {
  const addr = parseAddress(text);
  const pretty = formatAddressParsed(addr);
  return [
    '🚚 *Envíos*',
    'Entregamos en La Plata, City Bell y alrededores.',
    pretty ? `Destino estimado: ${pretty}` : '',
    'Coordinamos horario con logística. Costos según zona y volumen.'
  ].filter(Boolean).join('\n');
}
