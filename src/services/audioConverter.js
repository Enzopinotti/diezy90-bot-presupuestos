// src/services/audioConverter.js
// ----------------------------------------------------
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Convierte un archivo de audio OPUS a MP3 usando ffmpeg
 * @param {string} inputPath - Ruta del archivo OPUS
 * @param {string} outputPath - Ruta donde guardar el MP3
 * @returns {Promise<boolean>} - true si la conversión fue exitosa
 */
export async function convertOpusToMp3(inputPath, outputPath) {
    try {
        console.log('🔄 [FFMPEG] Convirtiendo OPUS a MP3...');
        console.log('📁 [FFMPEG] Input:', inputPath);
        console.log('📁 [FFMPEG] Output:', outputPath);

        // Convertir OPUS a MP3 con ffmpeg
        // -i: input file
        // -acodec libmp3lame: usar codec MP3
        // -ar 16000: sample rate 16kHz (óptimo para speech)
        // -ac 1: mono (reduce tamaño, suficiente para voz)
        // -b:a 32k: bitrate 32kbps (suficiente para voz)
        const { stdout, stderr } = await execAsync(
            `ffmpeg -i "${inputPath}" -acodec libmp3lame -ar 16000 -ac 1 -b:a 32k "${outputPath}" -y`
        );

        console.log('✅ [FFMPEG] Conversión exitosa');
        if (stderr) console.log('ℹ️ [FFMPEG] Info:', stderr.substring(0, 200));

        return true;
    } catch (error) {
        console.error('❌ [FFMPEG] Error converting OPUS to MP3:', error.message);
        console.error('❌ [FFMPEG] Stack:', error.stack);
        return false;
    }
}
