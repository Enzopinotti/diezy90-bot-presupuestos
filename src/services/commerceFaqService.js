// src/services/commerceFaqService.js
// ----------------------------------------------------
// Respuestas comerciales periféricas (stock/horarios/envíos/pagos)
// Pueden conectarse a APIs reales después; ahora son plantillas.

import { env } from '../config/env.js';
import { parseAddress, formatAddressParsed } from './addressService.js';

export function answerHours() {
  return [
    '🕒 *Horarios*',
    'Lunes a Viernes: 8:00–17:00',
    'Sábados: 8:00–13:00',
    'Domingos: cerrado',
  ].join('\n');
}

export function answerLocation() {

  return [
    '📍 *Ubicación*',
    '10 y 90',
    'Calle 90 N° 757 esq. 10 – La Plata',
    'Tel: 221-4516849 | WhatsApp: 221-5064398'
  ].join('\n');
}

export function answerPayment() {
  return [
    '💳 *Medios de pago*',
    '• Efectivo',
    '• Transferencia',
    '• Mercado Pago',
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
    '',
    '⚠️ *Flete a confirmar según zona y cantidad*'
  ].filter(Boolean).join('\n');
}
