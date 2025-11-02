// /src/services/sttService.js
import OpenAI from 'openai';
import fs from 'fs';
import { env } from '../config/env.js';

const openai = new OpenAI({ apiKey: env.openai.apiKey });

/**
 * Transcribe audio (es-ES/es-AR) usando Whisper.
 * filePath: ruta temporal del audio recibido.
 */
export async function transcribeAudio(filePath) {
  const file = fs.createReadStream(filePath);
  const res = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'es'
  });
  return res.text || '';
}