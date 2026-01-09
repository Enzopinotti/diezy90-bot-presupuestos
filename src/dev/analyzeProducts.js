// src/dev/analyzeProducts.js
// Script para analizar la estructura de productos y encontrar patrones problemáticos
// Ejecutar: node src/dev/analyzeProducts.js

import 'dotenv/config';
import axios from 'axios';

// Leer config de env
const shop = process.env.SHOPIFY_SHOP;
const token = process.env.SHOPIFY_ACCESS_TOKEN;
const version = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!shop || !token) {
    console.error('❌ Faltan SHOPIFY_SHOP o SHOPIFY_TOKEN en .env');
    process.exit(1);
}

const api = axios.create({
    baseURL: `https://${shop}/admin/api/${version}/`,
    headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
    }
});

const categories = [
    'arena', 'cemento', 'piedra', 'cal', 'ladrillo', 'hierro', 'malla',
    'vigueta', 'escombro', 'tosca', 'plasticor', 'hidrofugo', 'pegamento',
    'viga', 'columna', 'estribo', 'alambre', 'clavo', 'tornillo', 'perfil', 'chapa'
];

async function fetchProducts() {
    const res = await api.get('products.json?limit=250');
    return res.data?.products || [];
}

async function analyze() {
    console.log('🔍 Obteniendo productos de Shopify (directo, sin Redis)...\n');

    const rawProducts = await fetchProducts();
    const products = rawProducts.map(p => ({
        id: p.id,
        title: p.title,
        variants: p.variants.map(v => ({
            id: v.id,
            title: v.title,
            price: Number(v.price)
        }))
    }));

    console.log(`📦 Total de productos: ${products.length}\n`);

    // 1. Categorizar productos
    const categorized = {};
    const uncategorized = [];

    for (const p of products) {
        const titleLower = p.title.toLowerCase();
        let matched = false;

        for (const cat of categories) {
            if (titleLower.includes(cat)) {
                if (!categorized[cat]) categorized[cat] = [];
                categorized[cat].push(p);
                matched = true;
                break;
            }
        }

        if (!matched) {
            uncategorized.push(p);
        }
    }

    // 2. Mostrar resumen por categoría
    console.log('📊 PRODUCTOS POR CATEGORÍA:\n');
    console.log('='.repeat(60));

    for (const [cat, prods] of Object.entries(categorized).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${cat.toUpperCase()} (${prods.length} productos):`);
        prods.forEach(p => {
            const variantCount = p.variants?.length || 0;
            console.log(`  - ${p.title} [${variantCount} var]`);
        });
    }

    // 3. Productos SIN CATEGORÍA
    console.log('\n' + '='.repeat(60));
    console.log(`\n⚠️  PRODUCTOS SIN CATEGORÍA CONOCIDA (${uncategorized.length}):`);
    console.log('   Estos productos podrían fallar en el modo edición:\n');

    uncategorized.forEach(p => {
        const titleLower = p.title.toLowerCase();
        const firstWord = titleLower.split(' ')[0];
        const variantCount = p.variants?.length || 0;
        console.log(`  ❌ "${p.title}"`);
        console.log(`     → Primera palabra: "${firstWord}" (fallback para edición)`);
        console.log(`     → Variantes: ${variantCount}`);
        console.log('');
    });

    // 4. Análisis de primeras palabras únicas
    console.log('='.repeat(60));
    console.log('\n📝 PRIMERAS PALABRAS ÚNICAS EN PRODUCTOS SIN CATEGORÍA:');

    const firstWords = new Map();
    for (const p of uncategorized) {
        const fw = p.title.toLowerCase().split(' ')[0];
        if (!firstWords.has(fw)) firstWords.set(fw, []);
        firstWords.get(fw).push(p.title);
    }

    for (const [word, titles] of [...firstWords.entries()].sort((a, b) => b[1].length - a[1].length)) {
        if (titles.length >= 2) {
            console.log(`\n  "${word}" (${titles.length} prods) → AGREGAR a categorías`);
            titles.slice(0, 3).forEach(t => console.log(`    • ${t}`));
            if (titles.length > 3) console.log(`    ... +${titles.length - 3} más`);
        }
    }

    // 5. Estadísticas de variantes
    console.log('\n' + '='.repeat(60));
    const singleVariant = products.filter(p => p.variants.length === 1);
    const multiVariant = products.filter(p => p.variants.length > 1);

    console.log('\n📈 ESTADÍSTICAS DE VARIANTES:');
    console.log(`   - Productos con 1 variante: ${singleVariant.length}`);
    console.log(`   - Productos con múltiples variantes: ${multiVariant.length}`);

    if (multiVariant.length > 0) {
        console.log('\n   Ejemplos con múltiples variantes:');
        multiVariant.slice(0, 5).forEach(p => {
            console.log(`   📦 ${p.title}`);
            p.variants.forEach(v => console.log(`      → ${v.title} ($${v.price})`));
        });
    }

    console.log('\n✅ Análisis completado.');
}

analyze().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
