
import fs from 'fs/promises';
import { smartMatch } from './src/services/matchService.js';

async function test() {
    const catalogue = JSON.parse(await fs.readFile('./src/dev/catalogue_report.json', 'utf8'));
    const index = catalogue.products;
    console.log(`Index size: ${index.length}`);

    const lines = [
        '10 hierro del 8',
        '2 palets del 12',
        '30 bolsas de cemento de 25kg',
        '50 del 12',
        '5 varillas del 6',
        '1 pallet del 18'
    ];

    const results = [];
    const clarify = [];
    const notFound = [];

    for (const line of lines) {
        console.log(`\n--- Testing: "${line}" ---`);

        // Improved simulation of WATI loop
        let clean = line;
        const qtyMatches = [...clean.matchAll(/\b(?:x|por|a)\s*(\d+(?:[.,]\d+)?)\b/gi)];
        let lineQty = 1;
        if (qtyMatches.length) {
            lineQty = Number(String(qtyMatches[qtyMatches.length - 1][1]).replace(',', '.'));
        } else {
            const prefixMatch = clean.match(/^\s*(?:[-*•]\s*)?(\d+(?:[.,]\d+)?)\b/);
            if (prefixMatch) {
                lineQty = Number(String(prefixMatch[1]).replace(',', '.'));
                clean = clean.substring(prefixMatch[0].length).trim();
            }
        }
        // Note: del/de are handled by expandShorthands/stripFiller inside smartMatch now

        const r = await smartMatch(clean, index, lineQty);

        if (r.accepted.length > 0) {
            console.log(`✅ ACCEPTED: ${r.accepted.map(a => `${a.qty}x ${a.product.title}`).join(', ')}`);
            results.push(...r.accepted);
        } else if (r.clarify.length > 0) {
            console.log(`❓ CLARIFY: ${r.clarify[0].question}`);
            clarify.push(...r.clarify);
        } else {
            console.log(`❌ NOT FOUND: ${line}`);
            notFound.push(line);
        }
    }

    console.log('\n--- FINAL SUMMARY ---');
    console.log(`Accepted: ${results.length}`);
    console.log(`Clarify: ${clarify.length}`);
    console.log(`Not Found: ${notFound.length}`);
}

test().catch(console.error);
