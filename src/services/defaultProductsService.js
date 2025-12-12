// src/services/defaultProductsService.js
// ----------------------------------------------------
// Maneja productos por defecto para términos genéricos (arena, cemento, piedra)

// Mapeo de términos genéricos a productos específicos más vendidos
const DEFAULT_PRODUCTS = {
    'arena': 'arena bolson x 1m3',
    'piedra': 'piedra 6/20 granitica bolson x 1 m3',
    'cemento': 'cemento cpc40 h f'  // Cambiado de 'cemento hf' para matchear nombre real
};

/**
 * Determina si un término es genérico y debe usar producto por defecto
 * @param {string} term - Término de búsqueda normalizado
 * @returns {string|null} - Producto por defecto o null si no aplica
 */
export function getDefaultProduct(term) {
    const normalized = String(term || '').toLowerCase().trim();

    // Lista de nombres específicos de productos que NO deben usar defaults
    // Estos son nombres exactos de productos y debe buscarse/desambiguarse
    const SPECIFIC_PRODUCTS = [
        'plasticor',
        'portland',
        'cpc40',
        'granel',
        'bolsita',
        'balde',
        '1/2',
        '0.5',
        'medio',
        'media',
        '3m3',
        '6m3'
    ];

    if (SPECIFIC_PRODUCTS.some(sp => normalized.includes(sp))) {
        return null; // NO usar default, buscar el producto específico
    }

    // Detectar términos genéricos sin especificaciones
    // Ej: "arena" SÍ, "media arena" NO, "arena bolsita" NO

    // Regex más flexibles:
    // - Prefijos opcionales: "de", "bolson de", "bolsones de", "1m3 de"
    // - Sufijos opcionales: "bolson", "bolsones", "1m3", "x 1m3"

    const prefix = /(?:^|\s)(?:(?:bols[oó]ne?s?|1\s*m3)\s+de\s+|de\s+)?/i;
    const suffix = /(?:\s+(?:bols[oó]ne?s?|x?\s*1\s*m3))?$/i;

    // Construimos regex dinámicas para no repetir lógica
    const mkRe = (word) => new RegExp(prefix.source + word + suffix.source, 'i');

    if (mkRe('arenas?').test(normalized)) {
        return DEFAULT_PRODUCTS.arena;
    }

    if (mkRe('piedras?').test(normalized)) {
        return DEFAULT_PRODUCTS.piedra;
    }

    if (mkRe('cementos?').test(normalized)) {
        return DEFAULT_PRODUCTS.cemento;
    }

    return null;
}

/**
 * Verifica si el término tiene especificaciones (medio, bolsita, etc)
 * que requieren mostrar opciones en lugar de usar default
 */
export function hasSpecifications(term) {
    const t = String(term || '').toLowerCase();

    // Palabras que indican especificaciones
    const specs = [
        'medio', '1/2', '0.5', 'bolsita',
        'granel', 'camion', 'camión', '6m3', '3m3',
        'balde', 'cpc40', 'hf', 'portland'
    ];

    return specs.some(spec => t.includes(spec));
}
