// src/services/quoteFormatter.js
// ----------------------------------------------------
// Arma el texto del presupuesto para WhatsApp/WATI, con lista + tabla monoespaciada estable.
// Evita caracteres raros y recorta nombres largos con '…'.

function money(n){ return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(n||0); }
function pad(str, len){ 
  const s = String(str ?? '');
  return s.length <= len ? s.padEnd(len, ' ') : (s.slice(0, Math.max(0,len-1)) + '…');
}
function padLeft(str, len){
  const s = String(str ?? '');
  return s.length <= len ? s.padStart(len, ' ') : (s.slice(0, Math.max(0,len-1)) + '…');
}

export function buildQuoteMessage({ title='🧾 Presupuesto', items=[], cashDiscount=0.10, validity='1 día.' }){
  // items: [{name, qty, unitName, unitPrice, subtotal}]
  const lines = [];
  lines.push(`${title}`);

  // Lista amigable
  items.forEach((it, idx)=>{
    lines.push(`${idx+1}) ${it.name} — x${it.qty} → ${money(it.subtotal)}`);
  });

  lines.push('');
  // Tabla monoespaciada en bloque de codigo (WhatsApp respeta ancho fijo en ``` ... ```)
  const COLS = { idx:3, desc:37, qty:4, unit:10, sub:12 }; // tot: 3+1+37+1+4+1+10+1+12=70 aprox
  const header = (
    pad('#', COLS.idx) + ' ' +
    pad('Ítem', COLS.desc) + ' ' +
    pad('Cant', COLS.qty) + ' ' +
    pad('Unit', COLS.unit) + ' ' +
    pad('Subtotal', COLS.sub)
  );
  const sep = ''.padEnd(header.length, '-');

  const rows = items.map((it, idx) => {
    return (
      pad(String(idx+1), COLS.idx) + ' ' +
      pad(it.shortName || it.name, COLS.desc) + ' ' +
      padLeft(it.qty, COLS.qty) + ' ' +
      pad(money(it.unitPrice), COLS.unit) + ' ' +
      padLeft(money(it.subtotal), COLS.sub)
    );
  });

  lines.push('```');
  lines.push(header);
  lines.push(sep);
  lines.push(...rows);
  lines.push('```');

  // Totales
  const subtotal = items.reduce((a,b)=> a + (b.subtotal||0), 0);
  const efectivo = subtotal * (1 - (cashDiscount||0));

  lines.push('');
  lines.push('Totales');
  lines.push(`* 💵 Efectivo (−${Math.round((cashDiscount||0)*100)}%): ${money(efectivo)}`);
  lines.push(`* Subtotal materiales: ${money(subtotal)}`);
  lines.push('');
  lines.push(`🕘 Validez de precios: ${validity}`);
  lines.push('⌨️ Comandos rápidos: VER • CONFIRMAR (PDF) • CANCELAR • CAMBIAR 2 x 5 • QUITAR 3 • sumale 2 al último.');

  return lines.join('\n');
}
