// /src/services/ocrService.js
import tesseract from 'node-tesseract-ocr';
import sharp from 'sharp';
import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Preprocesa una imagen para mejorar la precisión del OCR.
 * - Escala de grises
 * - Normalización
 * - Aumento de contraste
 * - Binarización (threshold)
 * - Upscaling 2x para mejor resolución
 */
async function preprocessImage(inputPath) {
  const processedPath = inputPath.replace(/\.(jpg|png|jpeg)$/i, '_processed.png');

  const metadata = await sharp(inputPath).metadata();

  await sharp(inputPath)
    .grayscale()
    .normalize()
    .linear(1.5, -(128 * 0.5))
    .threshold(128)
    .resize({
      width: metadata.width * 2,
      height: metadata.height * 2,
      kernel: 'lanczos3'
    })
    .toFile(processedPath);

  return processedPath;
}

/**
 * Evalúa si el texto extraído por Tesseract es de buena calidad.
 * Retorna true si parece válido, false si es basura.
 */
function isGoodOcrQuality(text = '') {
  if (!text || text.length < 10) return false;

  // Contar caracteres alfanuméricos vs basura
  const alphanumeric = text.match(/[a-záéíóúñ0-9]/gi) || [];
  const total = text.replace(/\s/g, '').length;

  if (total === 0) return false;
  const ratio = alphanumeric.length / total;

  // Si menos del 70% son caracteres válidos, es basura (más estricto)
  if (ratio < 0.7) return false;

  // Verificar longitud promedio de palabras (filtra ruido tipo "a o . , x")
  const words = text.match(/[a-záéíóúñ]{2,}/gi) || [];
  if (words.length < 3) return false; // Muy pocas palabras reales
  const avgLength = words.reduce((a, w) => a + w.length, 0) / words.length;
  if (avgLength < 3.5) return false; // Palabras muy cortas en promedio (ruido)

  // Verificar si tiene al menos 2 líneas con números Y letras
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const validLines = lines.filter(l => {
    const hasNumber = /\d/.test(l);
    const hasLetter = /[a-záéíóúñ]/i.test(l);
    return hasNumber && hasLetter;
  });

  if (validLines.length < 1) return false; // Al menos 1 línea válida (bajé de 2 porque a veces es 1 ítem)

  // Verificar que contenga al menos una palabra clave de PRODUCTO (fuerte)
  // No aceptamos solo unidades (m3, kg) porque pueden ser ruido
  const productKeywords = /\b(arena|piedra|cemento|plasticor|cal|ladrillo|ceramico|vigueta|hierro|malla|fino|grueso|portland|avellaneda|loma|negra|holcim|hidralit|klaukol|weber|sika|cerecita|tacuru|cascote|escombro|tosca)\b/i;

  if (!productKeywords.test(text)) return false;

  return true;
}

/**
 * Usa GPT-4 Vision para leer la imagen.
 * Pide específicamente que extraiga listas de materiales de construcción.
 */
async function readWithVision(imagePath) {
  console.log('🤖 [VISION] Usando GPT-4 Vision para leer la imagen...');

  // Convertir imagen a base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Esta imagen contiene una lista de materiales de construcción manuscrita. ' +
              'Por favor, extrae EXACTAMENTE el texto de cada línea, manteniendo el formato "cantidad de producto". ' +
              'Si no puedes leer algo, omítelo. Responde SOLO con la lista, una línea por ítem, sin explicaciones adicionales.'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType}; base64, ${base64Image} `
            }
          }
        ]
      }
    ],
    max_tokens: 500
  });

  const extractedText = response.choices[0]?.message?.content?.trim() || '';
  console.log('✅ [VISION] Texto extraído COMPLETO:\n', extractedText);

  return extractedText;
}

/**
 * Realiza OCR en español con fallback a Vision.
 * 1. Intenta con Tesseract (rápido, gratis)
 * 2. Si el resultado es malo, usa GPT-4 Vision (preciso, pago)
 * @param {string} filePath - Ruta del archivo de imagen
 * @param {Function} progressCallback - Callback opcional que se llama cuando se usa Vision
 */
export async function ocrImageToText(filePath, progressCallback = null) {
  let processedPath = null;
  try {
    // Intentar con Tesseract primero
    console.log('🔧 [OCR] Preprocesando imagen...');
    processedPath = await preprocessImage(filePath);
    console.log('✅ [OCR] Imagen preprocesada:', processedPath);

    const tesseractText = await tesseract.recognize(processedPath, {
      lang: 'spa',
      oem: 1,
      psm: 6
    });

    console.log('📊 [OCR] Evaluando calidad del resultado de Tesseract...');

    // Verificar calidad
    if (isGoodOcrQuality(tesseractText)) {
      console.log('✅ [OCR] Tesseract produjo buen resultado');
      return tesseractText;
    }

    console.log('⚠️ [OCR] Tesseract produjo resultado de baja calidad, usando Vision API...');

    // Notificar que estamos usando Vision (puede tardar)
    if (progressCallback) {
      await progressCallback();
    }

    // Fallback a Vision API
    const visionText = await readWithVision(filePath);
    return visionText;

  } catch (error) {
    console.error('Error en OCR:', error);

    // Si Tesseract falla, intentar Vision como último recurso
    try {
      console.log('🔄 [OCR] Tesseract falló, intentando Vision API...');

      if (progressCallback) {
        await progressCallback();
      }

      return await readWithVision(filePath);
    } catch (visionError) {
      console.error('Error en Vision API:', visionError);
      return null;
    }
  } finally {
    // Limpiar imagen procesada
    if (processedPath && fs.existsSync(processedPath)) {
      try {
        fs.unlinkSync(processedPath);
        console.log('🗑️ [OCR] Imagen procesada eliminada:', processedPath);
      } catch { }
    }
  }
}