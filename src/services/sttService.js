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
  try {
    console.log('🎤 [WHISPER] Iniciando transcripción de:', filePath);

    const file = fs.createReadStream(filePath);
    const res = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'es',
      // Prompt para mejorar precisión con términos de construcción
      prompt: 'Lista de materiales de construcción: arena, cemento, piedra, ladrillo, hierro, malla, cerámica, hidrofugo, vigueta, alambre'
    });

    const transcribedText = res.text || '';
    console.log('✅ [WHISPER] Texto transcrito:', JSON.stringify(transcribedText));
    console.log('📝 [WHISPER] Longitud:', transcribedText.length, 'caracteres');

    return transcribedText;
  } catch (error) {
    console.error('❌ [WHISPER] Error transcribiendo audio:', error.message);
    console.error('❌ [WHISPER] Stack:', error.stack);
    return null; // Retornar null para que el caller pueda detectar el error
  }
}