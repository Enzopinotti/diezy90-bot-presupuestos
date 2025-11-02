// /src/services/pdfService.js
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { env } from '../config/env.js';

export async function generateBudgetPDF({ items = [], totals, notFound = [], meta = {} }) {
  const templatePath = path.resolve('src/templates/budget.html');
  let html = await fs.readFile(templatePath, 'utf-8');

  // Muy simple: reemplazar placeholders. Recomendado migrar a un motor de templates.
  html = html
    .replace('{{FOOTER}}', env.business.pdfFooterText)
    .replace('{{NUMBER}}', meta.number || 'P-0001')
    .replace('{{DATE}}', new Date().toLocaleDateString('es-AR'));

  const rows = items.map(i => `
    <tr>
      <td>${i.title}</td>
      <td>${i.qty}</td>
      <td>${i.subtotalLista}</td>
    </tr>
  `).join('');
  html = html.replace('<!--ROWS-->', rows);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdfBuffer;
}