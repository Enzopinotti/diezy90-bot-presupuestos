// src/services/watiService.js
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const msisdn = (to) => String(to).replace(/[^\d]/g, '');

const api = axios.create({
  baseURL: env.wati.baseUrl,
  headers: { Authorization: `Bearer ${env.wati.apiKey}` },
  timeout: 15000
});

function logOk(tag, to, extra) {
  logger.info({ tag, phone: to, ...extra }, `OUTBOUND [${tag}]`);
}
function logErr(tag, to, err) {
  logger.error({
    tag, to,
    status: err?.response?.status,
    data: err?.response?.data,
    msg: err?.message
  }, 'WATI ERR');
}

// Envía texto en chunks “seguros” para evitar límites de WhatsApp/WATI
export async function sendText(to, message) {
  const dest = msisdn(to);
  const chunks = splitForWhatsapp(String(message ?? ''), 1900); // margen seguro
  let last;
  for (const part of chunks) {
    try {
      const form = new URLSearchParams();
      form.append('messageText', part);
      const { status, data } = await api.post(
        `/sendSessionMessage/${encodeURIComponent(dest)}`,
        form.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      logOk('sendText', dest, { text: part, status, data });
      last = { ok: data?.result !== false, status, data };
    } catch (e) {
      logErr('sendText', dest, e);
      last = { ok: false, error: e?.response?.data || e.message };
    }
  }
  return last || { ok: false };
}

function splitForWhatsapp(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// Envía un archivo PDF en sesión (usamos el endpoint de file de WATI)
export async function sendPdf(to, filePath, filename = 'presupuesto.pdf') {
  const dest = msisdn(to);
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { filename });
    const { status, data } = await api.post(
      `/sendSessionFile/${encodeURIComponent(dest)}`,
      form,
      { headers: form.getHeaders() }
    );
    logOk('sendPdf', dest, { status, data, filename });
    return { ok: data?.result !== false, status, data };
  } catch (e) {
    logErr('sendPdf', dest, e);
    return { ok: false, error: e?.response?.data || e.message };
  }
}

/* Opcional: disparo de plantilla HSM desde backend (si alguna vez lo necesitás).
   Si no lo usás, podés borrar esta función sin problema. */
export async function sendTemplate(to, templateName, parameters = []) {
  const dest = msisdn(to);
  try {
    const payload = {
      template_name: templateName,
      broadcast_name: 'backend-auto',
      parameters,
      // según versión de WATI, a veces se requiere "wa_numbers" o "to":
      // wa_numbers: [dest],
      // to: dest,
    };
    const { status, data } = await api.post(`/sendTemplateMessage`, payload);
    logOk('sendTemplate', dest, { status, data, templateName });
    return { ok: data?.result !== false, status, data };
  } catch (e) {
    logErr('sendTemplate', dest, e);
    return { ok: false, error: e?.response?.data || e.message };
  }
}

/**
 * Descarga un archivo de media (audio/imagen) desde WATI
 * @param {string} url - URL del archivo en WATI
 * @param {string} destPath - Ruta donde guardar el archivo
 * @returns {Promise<boolean>} - true si se descargó correctamente
 */
export async function downloadMedia(url, destPath) {
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: { Authorization: `Bearer ${env.wati.apiKey}` }
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(true));
      writer.on('error', reject);
    });
  } catch (e) {
    logger.error({ url, error: e.message }, 'Error downloading media');
    return false;
  }
}

/**
 * Envía mensaje interactivo con botones (máx 3)
 * @param {string} to - Número de teléfono
 * @param {string} bodyText - Texto del mensaje
 * @param {Array} buttons - Botones [{id: 'btn_1', title: 'Opción 1'}, ...]
 */
export async function sendInteractiveButtons(to, bodyText, buttons) {
  const dest = msisdn(to);
  try {
    const payload = {
      body: bodyText,
      buttons: buttons.map(btn => ({ text: btn.title }))
    };
    const { status, data } = await api.post(
      `/sendInteractiveButtonsMessage?whatsappNumber=${encodeURIComponent(dest)}`,
      payload
    );
    logOk('sendInteractiveButtons', dest, { bodyText, buttons, status, data });
    return { ok: data?.result !== false, status, data };
  } catch (e) {
    logErr('sendInteractiveButtons', dest, e);
    return { ok: false, error: e?.response?.data || e.message };
  }
}

/**
 * Envía mensaje interactivo con lista (máx 10 opciones)
 * @param {string} to - Número de teléfono
 * @param {string} bodyText - Texto del mensaje
 * @param {string} buttonLabel - Texto del botón que abre la lista
 * @param {Array} sections - Secciones [{title: 'Sección', rows: [{id: 'row_1', title: 'Item', description: '...'}]}]
 */
export async function sendInteractiveList(to, bodyText, buttonLabel, sections) {
  const dest = msisdn(to);
  try {
    const payload = {
      body: bodyText,
      buttonText: buttonLabel,
      sections: sections
    };
    const { status, data } = await api.post(
      `/sendInteractiveListMessage?whatsappNumber=${encodeURIComponent(dest)}`,
      payload
    );
    logOk('sendInteractiveList', dest, { bodyText, sections, status, data });

    // Si WATI devuelve ok:false, tratarlo como error
    if (data?.ok === false) {
      return { ok: false, error: data?.errors?.join(', ') || 'Unknown error', data };
    }

    return { ok: true, status, data };
  } catch (e) {
    logErr('sendInteractiveList', dest, e);
    return { ok: false, error: e?.response?.data || e.message };
  }
}
