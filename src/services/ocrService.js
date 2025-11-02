// /src/services/ocrService.js
import tesseract from 'node-tesseract-ocr';

/**
 * Realiza OCR en español. Devuelve texto plano.
 * Preprocesamiento de imagen (sharp) podría agregarse antes de OCR si hace falta.
 */
export async function ocrImageToText(filePath) {
  return tesseract.recognize(filePath, {
    lang: 'spa',
    oem: 1,
    psm: 6
  });
}