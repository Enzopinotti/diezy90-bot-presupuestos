// src/dev/generateMarkdownReport.js
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('/Users/enzopinotti/Desktop/diez-y-90-presupuesto-bot/src/dev/catalogue_report.json', 'utf8'));
const products = data.products;

let md = '# Reporte Completo de Catálogo (Shopify)\n\n';
md += `**Total de productos:** ${products.length}\n\n`;

md += '| ID | Título | SKU | Peso | Precio | Tags |\n';
md += '|---|---|---|---|---|---|\n';

products.forEach(p => {
    const v = p.variants[0]; // Ya sabemos que todos tienen 1 sola variante
    md += `| ${p.id} | ${p.title} | ${v.sku || '*N/A*'} | ${v.weight} ${v.weight_unit} | $${v.price} | ${p.tags || '*N/A*'} |\n`;
});

fs.writeFileSync('/Users/enzopinotti/Desktop/diez-y-90-presupuesto-bot/src/dev/catalogue_readable.md', md);
console.log('📄 Reporte Markdown guardado en: src/dev/catalogue_readable.md');
