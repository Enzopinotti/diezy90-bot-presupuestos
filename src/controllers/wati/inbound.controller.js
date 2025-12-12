// src/controllers/wati/inbound.controller.js
// ----------------------------------------------------
import fs from 'fs';
import { norm, isNewCommand } from './utils.js';
import { handleGreetingsOrCatalog } from './greetings.controller.js';
import { startBudget, handleBudgetMessage } from './budget.controller.js';
import { getSession, getSnapshot, setSession, markInboundIfNew } from '../../services/sessionService.js';
import { transcribeAudio } from '../../services/sttService.js';
import { ocrImageToText } from '../../services/ocrService.js';
import { sendText, downloadMedia } from '../../services/watiService.js';
import { buildProductIndex } from '../../services/shopifyService.js';
import { smartMatch } from '../../services/matchService.js';
import { computeLineTotals } from '../../services/priceService.js';
import { isLikelyBudgetList, splitLinesSmart, sanitizeText } from '../../services/textService.js';
import { answerDelivery, answerHours, answerLocation, answerPayment } from '../../services/commerceFaqService.js';

function fmtExpiry(ts) {
  try { return new Date(ts).toLocaleString('es-AR'); } catch { return null; }
}
function isBudgetCommand(T = '') {
  // T ya viene en MAYÚSCULAS por norm()
  return T === 'PRESUPUESTO' || T === 'PRESUPUESTOS' || T === 'PRESUPUESTO.' || T === 'PRESUPUESTOS.';
}

export async function watiInboundController(req, res) {
  // ACK inmediato
  res.status(200).json({ ok: true });

  try {
    const body = req.body || {};
    const phone = body?.waId || body?.to || body?.from || 'unknown';
    const name = body?.profileName || body?.senderName || body?.name || null;
    if (!phone || phone === 'unknown') return;

    // Idempotencia por messageId si viene en el payload
    const msgId = body?.messageId || body?.id || body?.waMessageId || null;
    if (!(await markInboundIfNew(msgId))) return;

    // Texto base
    let text = (body?.text || body?.message || '').toString().trim();

    // 🎛️ Manejo de respuestas de botones interactivos
    if (body?.interactiveButtonReply?.id) {
      const btnId = body.interactiveButtonReply.id;
      const btnTitle = body.interactiveButtonReply.title || '';
      console.log('🔘 [BUTTON] Respuesta de botón:', btnId, 'Title:', btnTitle);

      // Mapear botones a comandos (por ID o por Título si WATI devuelve números)
      if (btnId === 'presupuesto' || btnTitle.includes('Presupuesto')) text = 'PRESUPUESTO';
      else if (btnId === 'catalogo' || btnTitle.includes('Catálogo')) text = 'CATALOGO';
      else if (btnId === 'continuar' || btnTitle === 'Continuar') text = 'CONTINUAR';
      else if (btnId === 'nuevo' || btnTitle === 'Nuevo') text = 'NUEVO';

      else if (btnId === 'finalize' || btnTitle.includes('Finalizar')) text = 'CONFIRMAR';
      else if (btnId === 'edit' || btnTitle.includes('Editar')) text = 'EDITAR';
      else if (btnId === 'confirm_no' || btnTitle === '❌ Cancelar') text = 'CANCELAR';

      else if (btnId === 'cancel_yes' || btnTitle.includes('Sí, cancelar')) text = 'CANCELAR SI';
      else if (btnId === 'cancel_no' || btnTitle.includes('No, seguir')) text = 'NO';

      else if (btnId === 'confirm_add_yes' || btnTitle.includes('Sí, agregar')) text = 'si';
      else if (btnId === 'confirm_add_no' || btnTitle === '❌ No') text = 'no';

      else text = btnTitle || text;

      // IMPORTANTE: Actualizar body.text para que los handlers reciban el comando mapeado
      body.text = text;
    }

    if (body?.listReply?.id) {
      const rowId = body.listReply.id;
      console.log('📋 [LIST] Respuesta de lista:', rowId);
      text = rowId;
      // IMPORTANTE: Actualizar body.text para que los handlers reciban el ID
      body.text = text;
    }

    // Media desde WATI (viene como URL en body.data)
    // 🎯 PRIORIDAD: Si ya hay texto, ignorar audio/imagen
    const hasText = text && text.trim().length > 0;

    if (body?.type && body?.data && (body.type === 'audio' || body.type === 'image') && !hasText) {
      const mediaUrl = body.data;
      const ext = body.type === 'audio' ? 'opus' : 'jpg';
      const tmpPath = `/tmp/wati-${Date.now()}.${ext}`;

      try {
        console.log(`📥 [WATI] Descargando ${body.type} desde:`, mediaUrl);
        const downloaded = await downloadMedia(mediaUrl, tmpPath);

        if (downloaded) {
          console.log(`✅ [WATI] ${body.type} descargado en:`, tmpPath);

          if (body.type === 'audio') {
            // Mensajes variados para audio
            const audioMessages = [
              '🎤 Escuchando tu audio...',
              '🎧 Procesando tu mensaje de voz...',
              '🔊 Transcribiendo audio...'
            ];
            const randomAudioMsg = audioMessages[Math.floor(Math.random() * audioMessages.length)];
            await sendText(phone, randomAudioMsg);

            // Convertir OPUS a MP3 para Whisper
            const { convertOpusToMp3 } = await import('../../services/audioConverter.js');
            const mp3Path = tmpPath.replace('.opus', '.mp3');
            const converted = await convertOpusToMp3(tmpPath, mp3Path);

            if (converted) {
              const heard = await transcribeAudio(mp3Path);
              if (heard) {
                console.log('🎯 [AUDIO] Texto transcrito correctamente');
                console.log('📝 [AUDIO] Contenido:', heard);
                // Actualizar tanto text como body.text para que se procese
                text += `\n${heard}`;
                body.text = (body.text || '') + `\n${heard}`;
              } else {
                console.log('⚠️ [AUDIO] Whisper retornó null o vacío');
                await sendText(phone, '❌ No pude escuchar el audio. Intentá de nuevo o escribí tu lista.');
              }
              // Limpiar MP3
              try {
                fs.unlinkSync(mp3Path);
                console.log('🗑️ [CLEANUP] MP3 eliminado:', mp3Path);
              } catch { }
            } else {
              console.log('❌ [AUDIO] Falló la conversión OPUS → MP3');
              await sendText(phone, '❌ Error al procesar el audio. Intentá de nuevo.');
            }
          } else if (body.type === 'image') {
            // Mensajes variados para imagen
            const imageMessages = [
              '📷 Leyendo tu foto...',
              '📸 Analizando tu imagen...',
              '🖼️ Procesando foto...'
            ];
            const randomImageMsg = imageMessages[Math.floor(Math.random() * imageMessages.length)];
            await sendText(phone, randomImageMsg);

            // Callback para notificar cuando se usa Vision API
            const visionProgressCallback = async () => {
              await sendText(phone, '🤖 Analizando con IA...');
            };

            const seen = await ocrImageToText(tmpPath, visionProgressCallback);
            if (seen) {
              console.log('🎯 [OCR] Texto extraído:', seen.substring(0, 100) + '...');
              console.log('📝 [OCR] Contenido completo:', seen);
              // Actualizar tanto text como body.text para que se procese
              text += `\n${seen}`;
              body.text = (body.text || '') + `\n${seen}`;
            } else {
              console.log('⚠️ [OCR] No se pudo extraer texto de la imagen');
              await sendText(phone, '❌ No pude leer la foto. Asegurate que sea nítida e intentá de nuevo.');
            }
          }

          // Limpiar archivo temporal original
          try {
            fs.unlinkSync(tmpPath);
            console.log('🗑️ [CLEANUP] Archivo original eliminado:', tmpPath);
          } catch { }
        } else {
          console.log('❌ [WATI] Falló la descarga del archivo');
        }
      } catch (err) {
        console.error('❌ [ERROR] Error procesando media de WATI:', err);
        req.log?.error?.({ err, mediaUrl }, 'Error processing WATI media');
      }
    }

    // Media → STT / OCR (opcional)
    if (Array.isArray(req.files) && req.files.length) {
      for (const f of req.files) {
        try {
          if (f.mimetype?.startsWith?.('audio/')) {
            const heard = await transcribeAudio(f.path);
            if (heard) text += `\n${heard}`;
          } else if (f.mimetype?.startsWith?.('image/')) {
            const seen = await ocrImageToText(f.path);
            if (seen) text += `\n${seen}`;
          }
        } catch { }
      }
    }

    const T = norm(text);
    req.log?.info({ phone, eventType: body?.eventType, status: body?.statusString, text, name }, 'WATI inbound');

    // Tags internos (#algo)
    if (T.startsWith('#')) return;

    // —— NUEVO / PRESUPUESTO ——
    if (isNewCommand(T) || isBudgetCommand(T)) {
      await startBudget({ phone }); // acá sí queremos el mensaje largo
      // Ya no mostramos mensaje de snapshot guardado
      return;
    }

    // Greeting/Catálogo con fallback + oferta de reanudar si hay snapshot
    console.log('🔍 [FLOW] Verificando si es saludo/catálogo...');
    const intercepted = await handleGreetingsOrCatalog({ phone, textNorm: T, name });
    if (intercepted) {
      console.log('⛔ [FLOW] Interceptado por handleGreetingsOrCatalog');
      return;
    }
    console.log('✅ [FLOW] No es saludo/catálogo, continuando...');

    // Si hay sesión de presupuesto activa, seguimos
    const sess = await getSession(phone);
    console.log('🔍 [FLOW] Sesión actual:', sess?.mode || 'ninguna');
    if (sess?.mode === 'BUDGET') {
      console.log('✅ [FLOW] Modo BUDGET activo, llamando a handleBudgetMessage...');
      await handleBudgetMessage(req, body, phone);
      return;
    }
    console.log('⚠️ [FLOW] No hay sesión BUDGET activa');

    // FAQs fuera de presupuesto (atajos)
    if (/\b(horario|horarios|abren|cierran)\b/i.test(text)) { await sendText(phone, answerHours()); return; }
    if (/\b(ubicaci[oó]n|direccion|direcci[oó]n|donde estan|dónde estan)\b/i.test(text)) { await sendText(phone, answerLocation()); return; }
    if (/\b(pagos?|tarjeta|efectivo|transferencia|mercado\s*pago|mp)\b/i.test(text)) { await sendText(phone, answerPayment()); return; }
    if (/\b(envio|env[ií]o|delivery|entrega|reparto)\b/i.test(text)) { await sendText(phone, answerDelivery(text)); return; }

    // Auto-start si parece una lista de presupuesto
    console.log('🔍 [FLOW] Verificando si parece lista de presupuesto...');
    console.log('📝 [FLOW] Texto a evaluar:', text);
    const looksLikeBudget = isLikelyBudgetList(text);
    console.log('🎯 [FLOW] isLikelyBudgetList retornó:', looksLikeBudget);

    if (looksLikeBudget) {
      console.log('✅ [FLOW] Activando modo presupuesto automáticamente...');

      // Auto-start silencioso, sin mensaje extra
      await startBudget({ phone, silent: true });
      console.log('📋 [FLOW] Procesando lista con texto:', text);

      // Pasar el texto completo a handleBudgetMessage
      await handleBudgetMessage(req, { ...body, text }, phone);
      return;
    }


    console.log('⚠️ [FLOW] No parece una lista de presupuesto, mostrando menú principal');

    // Si llegamos aquí sin responder, mostramos el menú principal
    await sendInteractiveButtons(phone, '¿En qué puedo ayudarte?', [
      { id: 'presupuesto', title: '📋 Presupuesto' },
      { id: 'catalogo', title: '📚 Catálogo' }
    ]);
    return;

  } catch (err) {
    req.log?.error({ err }, 'Inbound processing error');
  }
}
