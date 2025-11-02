// /src/services/priceService.js
import { env } from '../config/env.js';

export function computeLineTotals(variant, qty) {
  const price = Number(variant.price || 0);
  const compare = variant.compare_at_price ? Number(variant.compare_at_price) : null;

  const subtotal = price * qty;
  // efectivo usa compare_at si es menor; sino -10%
  let efectivoSubtotal;
  if (compare && compare < price) {
    efectivoSubtotal = compare * qty;
  } else {
    efectivoSubtotal = subtotal * (1 - env.discounts.cash);
  }
  const transferenciaSubtotal = subtotal * (1 - env.discounts.transfer);

  return {
    lista: subtotal,
    transferencia: transferenciaSubtotal,
    efectivo: efectivoSubtotal
  };
}

export function currency(n) {
  return new Intl.NumberFormat(env.currencyLocale, { style: 'currency', currency: 'ARS' }).format(n);
}