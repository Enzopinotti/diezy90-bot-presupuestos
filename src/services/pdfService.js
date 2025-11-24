  // src/services/pdfService.js
  // ----------------------------------------------------
  import fs from 'fs/promises';
  import path from 'path';
  import puppeteer from 'puppeteer';
  import { env } from '../config/env.js';

  // ---------- Config negocio ----------
  function getBusiness() {
    const b = env?.business || {};
    return {
      docLetter: b.docLetter || process.env.PDF_DOC_LETTER || 'X',
      docType: b.docType || process.env.PDF_DOC_TYPE || 'Presupuesto',
      conditions: b.conditions || process.env.PDF_CONDITIONS || 'CONTADO',
      companyAddress: b.companyAddress || process.env.PDF_COMPANY_ADDRESS || 'CALLE 90 NRO 757 ESQ 10',
      companyPhone: b.companyPhone || process.env.PDF_COMPANY_PHONE || '221-4516849',
      companyWhatsapp: b.companyWhatsapp || process.env.PDF_COMPANY_WHATSAPP || '221-5064398',
      companyCUIT: b.companyCUIT || process.env.PDF_COMPANY_CUIT || '30-71193125-9',
      assetLogoPath: b.assetLogoPath || process.env.PDF_ASSET_LOGO || 'src/templates/assets/logoCorralon.png',
      assetWatermarkPath: b.assetWatermarkPath || process.env.PDF_ASSET_WATERMARK || 'src/templates/assets/noValidoComoFactura.jpg',
      pdfFooterText: b.pdfFooterText || process.env.PDF_FOOTER_TEXT || 'Validez: 1 día.',
      currencyLocale: env.currencyLocale || process.env.CURRENCY_LOCALE || 'es-AR'
    };
  }

  // ---------- Utilidades ----------
  function fmtCurrency(n, locale = 'es-AR', currency = 'ARS') {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(n) || 0); }
    catch { return `$ ${Number(n || 0).toFixed(2)}`; }
  }
  function parseCurrencyLoose(s) {
    if (typeof s === 'number') return s;
    const raw = String(s || '').trim();
    if (!raw) return NaN;
    let t = raw.replace(/[^\d.,-]/g, '');
    if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
    else if (t.includes(',')) t = t.replace(',', '.');
    return Number(t);
  }
  function injectVarsCI(html, vars) {
    let out = html;
    for (const [key, val] of Object.entries(vars)) {
      const re = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      out = out.replace(re, val != null ? String(val) : '');
    }
    return out;
  }
  function guessMimeByExt(p) {
    const ext = path.extname(String(p).toLowerCase());
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.svg') return 'image/svg+xml';
    return 'application/octet-stream';
  }
  async function readAsDataURI(filePath) {
    try {
      const abs = path.resolve(filePath);
      const buf = await fs.readFile(abs);
      const mime = guessMimeByExt(abs);
      const b64 = buf.toString('base64');
      return `data:${mime};base64,${b64}`;
    } catch { return ''; }
  }
  function sumSubtotals(items) {
    return (items || []).reduce((acc, it) => {
      const n = parseCurrencyLoose(it?.subtotalLista);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }
  function escapeHtml(s = '') {
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
      .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  // ---------- Puppeteer ----------
  let _cachedExecPath = null, _browser = null, _launching = null;
  async function resolveExecutablePath() {
    if (_cachedExecPath !== null) return _cachedExecPath;
    if (process.env.PUPPETEER_EXECUTABLE_PATH) { _cachedExecPath = process.env.PUPPETEER_EXECUTABLE_PATH; return _cachedExecPath; }
    const candidates = ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome-stable','/usr/bin/google-chrome'];
    for (const p of candidates) { try { await fs.access(p); _cachedExecPath = p; return _cachedExecPath; } catch {} }
    _cachedExecPath = null; return _cachedExecPath;
  }
  async function getBrowser() {
    if (_browser) return _browser;
    if (_launching) return _launching;
    _launching = (async () => {
      const executablePath = await resolveExecutablePath();
      try {
        const br = await puppeteer.launch({
          executablePath: executablePath || undefined,
          headless: true,
          args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--font-render-hinting=medium']
        });
        _browser = br;
        const tidy = async () => { try { await br.close(); } catch {} };
        process.once('exit', tidy);
        process.once('SIGINT', () => { tidy().finally(() => process.exit(0)); });
        process.once('SIGTERM', () => { tidy().finally(() => process.exit(0)); });
        return br;
      } catch (e) {
        e.message += '\n\nInstalá Chromium o pre-descargá Chrome (ver README de despliegue).';
        throw e;
      }
    })();
    try { return await _launching; } finally { _launching = null; }
  }

  // ---------- Render HTML (para preview/debug o servirlo si querés) ----------
  export async function generateBudgetHTML({ items = [], totals = {}, notFound = [], meta = {} } = {}) {
    const B = getBusiness();
    const templatePath = path.resolve('src/templates/budget.html');
    let html = await fs.readFile(templatePath, 'utf-8');

    const assetLogo = await readAsDataURI(meta.assetLogoPath || B.assetLogoPath);
    const assetWatermark = await readAsDataURI(meta.assetWatermarkPath || B.assetWatermarkPath);

    // Totales (fallback si no vienen formateados)
    const pctCash = totals.pctCash || `${Math.round((env.discounts?.cash ?? 0.10) * 100)}%`;
    const subtotalNum = parseCurrencyLoose(totals.subtotalLista);
    const subtotalLista = Number.isFinite(subtotalNum)
      ? fmtCurrency(subtotalNum, B.currencyLocale, 'ARS')
      : fmtCurrency(sumSubtotals(items), B.currencyLocale, 'ARS');

    const totalCashNum = parseCurrencyLoose(totals.totalCash);
    const totalCash = Number.isFinite(totalCashNum)
      ? fmtCurrency(totalCashNum, B.currencyLocale, 'ARS')
      : (() => {
          const base = parseCurrencyLoose(subtotalLista);
          const cash = base * (1 - (env.discounts?.cash ?? 0.10));
          return fmtCurrency(cash, B.currencyLocale, 'ARS');
        })();

    const clientName    = meta.clientName || 'CONSUMIDOR FINAL';
    const clientAddress = meta.clientAddress || '.';
    const clientPhone   = meta.clientPhone || (B.companyPhone || '');
    const docNumber     = meta.number || `P-${Date.now()}`;
    const todayStr      = new Date().toLocaleDateString('es-AR');

    const rowsHtml = (items || []).map((it) => {
      const title = it.title ?? it.name ?? '';
      const q = Number(it.qty || 0) || 0;
      const subNum = parseCurrencyLoose(it?.subtotalLista);
      let unitStr = it?.unitLista;
      if (unitStr == null || unitStr === '') {
        if (q > 0 && !Number.isNaN(subNum)) unitStr = fmtCurrency(subNum / q, B.currencyLocale, 'ARS');
        else unitStr = fmtCurrency(0, B.currencyLocale, 'ARS');
      }
      const subStr = (typeof it.subtotalLista === 'string')
        ? it.subtotalLista
        : fmtCurrency(subNum || 0, B.currencyLocale, 'ARS');
      return `
        <tr>
          <td>${escapeHtml(title)}</td>
          <td style="text-align:center">${q || ''}</td>
          <td style="text-align:right; white-space:nowrap">${escapeHtml(String(unitStr))}</td>
          <td style="text-align:right; white-space:nowrap">${escapeHtml(String(subStr))}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4">Sin ítems</td></tr>';

    const notFoundHtml = (notFound && notFound.length)
      ? (['<h3>Observaciones adicionales:</h3>','<ul>',...notFound.map(s => `<li>${escapeHtml(s)}</li>`),'</ul>'].join(''))
      : '';

    const vars = {
      NUMBER: docNumber,
      DATE: todayStr,
      CONDITIONS: B.conditions,
      DOC_LETTER: B.docLetter,
      DOC_TYPE: B.docType,
      // Empresa
      COMPANY_ADDRESS: B.companyAddress,
      COMPANY_PHONE: B.companyPhone,
      COMPANY_WHATSAPP: B.companyWhatsapp,
      COMPANY_CUIT: B.companyCUIT,

      // Logo y watermark
      ASSET_LOGO: assetLogo,
      ASSET_WATERMARK: assetWatermark,

      // Cliente
      CLIENT_NAME: clientName,
      CLIENT_ADDRESS: clientAddress,
      CLIENT_PHONE: clientPhone,

      // Totales
      SUBTOTAL_LISTA: subtotalLista,
      TOTAL_TRANSFER: totals.totalTransfer || fmtCurrency(subtotalNum * 0.96),
      TOTAL_EFECTIVO: totals.totalCash || fmtCurrency(subtotalNum * 0.90),
      PCT_TRANSFER: '4%',
      PCT_CASH: pctCash,

      FOOTER: B.pdfFooterText,

      // Filas
      ROWS_HTML: rowsHtml
    };


    html = injectVarsCI(html, vars);
    html = html.replace('<!--ROWS-->', vars.ROWS_HTML);
    return html;
  }

  // ---------- PDF (buffer) ----------
  export async function generateBudgetPDF({ items = [], totals = {}, notFound = [], meta = {} } = {}) {
    const html = await generateBudgetHTML({ items, totals, notFound, meta });
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Fuentes del SO / emojis
    await page.setContent(html, { waitUntil: ['load', 'domcontentloaded', 'networkidle0'] });
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' }
    });

    await page.close();
    return pdf;
  }
