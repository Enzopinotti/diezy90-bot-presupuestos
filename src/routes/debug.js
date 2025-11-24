// src/routes/debug.js
import { Router } from 'express';
import { generateBudgetPDF, generateBudgetHTML } from '../services/pdfService.js';

export const debug = Router();

// HTML de prueba (para ver en navegador)
debug.get('/debug/budget/preview', async (req, res) => {
  const items = [
    { title: 'ARENA BOLSON X 1M3', qty: 1, subtotalLista: '$ 45.388,48' },
    { title: 'PIEDRA 6/20 GRANITICA BOLSON X 1 M3', qty: 1, subtotalLista: '$ 75.396,08' },
    { title: 'CEMENTO AVELLANEDA 50KG', qty: 10, subtotalLista: '$ 200.000,00' }
  ];
  const payload = {
    items,
    totals: {
      subtotalLista: '$ 320.784,56',
      totalTransfer: '$ 304.745,33',
      totalCash:     '$ 288.706,10',
      pctTransfer: '5%',
      pctCash: '10%'
    },
    notFound: ['Tacurú x 10: no existe esa presentación.']
  };
  const html = await generateBudgetHTML(payload);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// PDF de prueba (para descargar)
debug.get('/debug/budget/pdf', async (req, res) => {
  const items = [
    { title: 'ARENA BOLSON X 1M3', qty: 1, subtotalLista: '$ 45.388,48' },
    { title: 'PIEDRA 6/20 GRANITICA BOLSON X 1 M3', qty: 1, subtotalLista: '$ 75.396,08' },
    { title: 'CEMENTO AVELLANEDA 50KG', qty: 10, subtotalLista: '$ 200.000,00' }
  ];
  const payload = {
    items,
    totals: {
      subtotalLista: '$ 320.784,56',
      totalTransfer: '$ 304.745,33',
      totalCash:     '$ 288.706,10',
      pctTransfer: '5%',
      pctCash: '10%'
    },
    notFound: ['Tacurú x 10: no existe esa presentación.'],
    meta: { number: 'P-DEBUG' }
  };
  const pdf = await generateBudgetPDF(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="presupuesto-debug.pdf"');
  res.send(pdf);
});
