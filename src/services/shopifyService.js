  // /src/services/shopifyService.js
  import axios from 'axios';
  import { env } from '../config/env.js';
  import { logger } from '../config/logger.js';
  import { redis } from '../config/redis.js';

  const api = axios.create({
    baseURL: `https://${env.shopify.shop}/admin/api/${env.shopify.version}/`,
    headers: {
      'X-Shopify-Access-Token': env.shopify.token,
      'Content-Type': 'application/json'
    }
  });

  const CACHE_KEY = 'd90:shopify:productIndex';
  const CACHE_TTL = 60 * 10; 

  export async function fetchAllProducts() {
    // Nota: para catálogos grandes conviene GraphQL y paginado.
    const res = await api.get('products.json?limit=250');
    return res.data?.products || [];
  }

  export async function buildProductIndex(force = false) {
    if (!force) {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    }
    const products = await fetchAllProducts();
    const index = products.map(p => ({
      id: p.id,
      title: p.title,
      variants: p.variants.map(v => ({
        id: v.id, sku: v.sku, title: v.title, price: Number(v.price),
        compare_at_price: v.compare_at_price ? Number(v.compare_at_price) : null
      }))
    }));
    await redis.set(CACHE_KEY, JSON.stringify(index), 'EX', CACHE_TTL);
    logger.info({ count: index.length }, 'Shopify index built');
    return index;
  }