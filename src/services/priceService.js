// /src/services/priceService.js
import { env } from '../config/env.js';

export function computeLineTotals(variant, qty) {
  const price = Number(variant.price || 0);
  const compareAt = variant.compare_at_price ? Number(variant.compare_at_price) : null;

  // Usar el MENOR entre price y compare_at_price como precio de referencia en efectivo
  // Si compare_at_price no existe, usar price
  const efectivoPrice = compareAt !== null ? Math.min(price, compareAt) : price;

  const subtotal = efectivoPrice * qty;

  // Ya no aplicamos descuentos adicionales porque el precio en Shopify ya viene con descuento
  return {
    lista: subtotal,        // precio en efectivo (el menor)
    transferencia: subtotal, // mismo precio
    efectivo: subtotal      // mismo precio
  };
}

export function currency(n) {
  return new Intl.NumberFormat(env.currencyLocale, { style: 'currency', currency: 'ARS' }).format(n);
}