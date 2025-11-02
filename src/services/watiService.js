// src/services/watiService.js
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Normaliza MSISDN: quita +, espacios y símbolos
const msisdn = (to) => String(to).replace(/[^\d]/g, '');

const api = axios.create({
  baseURL: env.wati.baseUrl, // ej: https://live-mt-server.wati.io/1035566/api/v1
  headers: { Authorization: `Bearer ${env.wati.apiKey}` }
});

export async function sendText(to, message) {
  try {
    await api.post(`/sendSessionMessage/${encodeURIComponent(msisdn(to))}`, {
      messageText: message
    });
    logger.debug({ to, len: message?.length }, 'WATI: text sent');
  } catch (e) {
    logger.error({ e: e?.response?.data || e.message }, 'WATI: sendText error');
  }
}

export async function sendPdf(to, filePath, filename = 'presupuesto.pdf') {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { filename });
    await api.post(`/sendSessionFile/${encodeURIComponent(msisdn(to))}`, form, {
      headers: form.getHeaders()
    });
    logger.debug({ to, filename }, 'WATI: pdf sent');
  } catch (e) {
    logger.error({ e: e?.response?.data || e.message }, 'WATI: sendPdf error');
  }
}

// Opcional: lista interactiva (para desambiguaciones futuras)
export async function sendInteractiveList(to, { header = 'Elegí una opción', body, sections }) {
  try {
    await api.post('/sendInteractiveListMessage', {
      to: msisdn(to),
      header,
      body,
      buttonText: 'Ver opciones',
      sections
    });
  } catch (e) {
    logger.error({ e: e?.response?.data || e.message }, 'WATI: sendInteractiveList error');
  }
}
