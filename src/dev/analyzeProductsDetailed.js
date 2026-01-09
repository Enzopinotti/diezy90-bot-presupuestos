// src/dev/analyzeProductsDetailed.js
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const shop = process.env.SHOPIFY_SHOP;
const token = process.env.SHOPIFY_ACCESS_TOKEN;
const version = process.env.SHOPIFY_API_VERSION || '2024-10';

const api = axios.create({
    baseURL: `https://${shop}/admin/api/${version}/`,
    headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
    }
});

async function fetchAllProducts() {
    let allProducts = [];
    let url = 'products.json?limit=250';

    while (url) {
        console.log(`📡 Fetching: ${url}`);
        const res = await api.get(url);
        allProducts = allProducts.concat(res.data.products);

        // Manejo de paginación por header 'Link'
        const link = res.headers['link'];
        if (link && link.includes('rel="next"')) {
            const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
            if (nextMatch) {
                url = nextMatch[1].split('/api/')[1];
            } else {
                url = null;
            }
        } else {
            url = null;
        }
    }
    return allProducts;
}

async function analyze() {
    console.log('🔍 Iniciando análisis profundo de productos y variantes...\n');

    const products = await fetchAllProducts();
    console.log(`\n📦 Total de productos encontrados: ${products.length}\n`);

    const stats = {
        totalVariants: 0,
        multiVariantProducts: 0,
        productsWithNoSKU: 0,
        productsWithWeight: 0
    };

    console.log('📋 DETALLE DE PRODUCTOS CON VARIANTES:\n');
    console.log('='.repeat(80));

    products.forEach(p => {
        const variantCount = p.variants.length;
        stats.totalVariants += variantCount;
        if (variantCount > 1) stats.multiVariantProducts++;

        console.log(`\nPROD: ${p.title} (ID: ${p.id})`);
        console.log(`  Options: ${p.options.map(o => o.name).join(', ')}`);

        p.variants.forEach((v, idx) => {
            if (!v.sku) stats.productsWithNoSKU++;
            if (v.weight > 0) stats.productsWithWeight++;

            console.log(`  [VAR ${idx + 1}] ${v.title}`);
            console.log(`    - ID: ${v.id}`);
            console.log(`    - Price: $${v.price}`);
            console.log(`    - SKU: ${v.sku || 'N/A'}`);
            console.log(`    - Weight: ${v.weight} ${v.weight_unit}`);
            if (v.option1 && v.option1 !== 'Default Title') console.log(`    - Opt1: ${v.option1}`);
            if (v.option2) console.log(`    - Opt2: ${v.option2}`);
            console.log(`    - Inventory: ${v.inventory_quantity ?? 'N/A'}`);
        });
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 RESUMEN FINAL:');
    console.log(`- Total Productos: ${products.length}`);
    console.log(`- Total Variantes: ${stats.totalVariants}`);
    console.log(`- Productos con +1 variante: ${stats.multiVariantProducts}`);
    console.log(`- Variantes sin SKU: ${stats.productsWithNoSKU}`);
    console.log(`- Variantes con peso definido: ${stats.productsWithWeight}`);

    console.log('\n✅ Análisis detallado completado.');

    // Guardar para análisis posterior
    fs.writeFileSync('/Users/enzopinotti/Desktop/diez-y-90-presupuesto-bot/src/dev/catalogue_report.json', JSON.stringify({ products, stats }, null, 2));
    console.log('📄 Reporte guardado en: src/dev/catalogue_report.json');
}

analyze().catch(err => {
    console.error('❌ Error:', err.message);
    if (err.response) console.error('Data:', JSON.stringify(err.response.data));
    process.exit(1);
});
