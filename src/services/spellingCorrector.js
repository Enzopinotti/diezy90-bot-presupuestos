// src/services/spellingCorrector.js
/**
 * Corrector ortográfico simple para términos comunes de construcción.
 * Maneja errores tipográficos frecuentes en WhatsApp.
 */

// Diccionario de correcciones: [error común] -> [forma correcta]
const CORRECTIONS = {
    // Cemento
    'simento': 'cemento',
    'cemnto': 'cemento',
    'cemeto': 'cemento',
    'simeto': 'cemento',
    'cimento': 'cemento',
    'semento': 'cemento',
    'plasticor': 'cemento', // Marca común
    'plastikor': 'cemento',

    // Arena
    'arenaa': 'arena',
    'arrena': 'arena',
    'aerna': 'arena',
    'harena': 'arena',

    // Piedra
    'peidra': 'piedra',
    'piedara': 'piedra',
    'piedrra': 'piedra',
    'pidera': 'piedra',
    'piera': 'piedra',

    // Ladrillo
    'ladrilo': 'ladrillo',
    'ladrillo': 'ladrillo',
    'ladrilo': 'ladrillo',
    'ladriylo': 'ladrillo',

    // Cerámica/Cerámico
    'ceramic': 'ceramico',
    'ceramica': 'ceramico',
    'seramico': 'ceramico',
    'zeramico': 'ceramico',

    // Bolsón/Bolsita
    'bolson': 'bolson',
    'volson': 'bolson',
    'volsita': 'bolsita',
    'boslita': 'bolsita',

    // Cal
    'cal': 'cal',
    'kal': 'cal',

    // Otros comunes
    'granel': 'granel',
    'graneel': 'granel',
    'granitca': 'granitica',
    'granitica': 'granitica',
    'blanca': 'blanca',
    'blaka': 'blanca',
    'hueco': 'hueco',
    'ueco': 'hueco',
    'weco': 'hueco',
    'huevo': 'hueco',

    // Unidades y medidas
    'metro': 'metro',
    'mtr': 'metro',
    'kilo': 'kilo',
    'kl': 'kilo',
    'unidad': 'unidad',
    'unidda': 'unidad',
    'unida': 'unidad',

    // Verbos de edición (argentinismos y errores)
    'sakame': 'sacame',
    'sakalo': 'sacalo',
    'saká': 'sacá',
    'kitame': 'quitame',
    'kitalo': 'quitalo',
    'kitá': 'quitá',
    'borralo': 'borralo',
    'borrá': 'borrá',
    'agregame': 'agregame',
    'agregá': 'agregá',
    'poneme': 'poneme',
    'poné': 'poné',
    'metele': 'metele',
    'tirale': 'tirale',
    'cambialo': 'cambialo',
    'cambiale': 'cambiale',
    'dejalo': 'dejalo',
    'dejá': 'dejá',

    // Variantes argentinas de materiales
    'arenita': 'arena',
    'arenilla': 'arena',
    'cementito': 'cemento',
    'ladriyos': 'ladrillos',
    'ladriyo': 'ladrillo',
    'varilla': 'varilla',
    'variya': 'varilla',
    'fierro': 'hierro',
    'fierrito': 'hierro'
};

/**
 * Normaliza y corrige errores ortográficos en un texto.
 * Aplica el diccionario de correcciones palabra por palabra.
 */
export function correctSpelling(text = '') {
    if (!text) return '';

    // Normalizar base (minúsculas, quitar tildes, limpiar)
    let normalized = String(text)
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}\s/.,-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Separar en palabras
    const words = normalized.split(/\s+/);

    // Aplicar correcciones
    const corrected = words.map(word => {
        // Si la palabra está en el diccionario de errores, corregir
        if (CORRECTIONS[word]) {
            return CORRECTIONS[word];
        }
        return word;
    });

    return corrected.join(' ');
}

/**
 * Versión alternativa: corrige solo si hay alta confianza.
 * Útil si queremos evitar sobre-correcciones.
 */
export function correctSpellingConservative(text = '') {
    if (!text) return '';

    let normalized = String(text)
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .trim();

    // Solo corregir palabras completas que estén exactamente en el diccionario
    for (const [wrong, right] of Object.entries(CORRECTIONS)) {
        // Usar regex con word boundaries para evitar correcciones parciales
        const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
        normalized = normalized.replace(regex, right);
    }

    return normalized;
}
