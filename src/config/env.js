//src/config/env.js
import 'dotenv/config';

export const env = {
  node: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  tz: process.env.TZ || 'America/Argentina/Buenos_Aires',
  currencyLocale: process.env.CURRENCY_LOCALE || 'es-AR',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // WATI
  wati: {
    baseUrl: process.env.WATI_BASE_URL || 'https://live.wati.io/api/v1',
    apiKey: process.env.WATI_API_KEY || '',
    webhookSecret: process.env.WATI_WEBHOOK_SECRET || ''
  },

  // Shopify
  shopify: {
    shop: process.env.SHOPIFY_SHOP || '',
    version: process.env.SHOPIFY_API_VERSION || '2024-10',
    token: process.env.SHOPIFY_ACCESS_TOKEN || ''
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || ''
  },

  // Discounts
  discounts: {
    cash: Number(process.env.DISCOUNT_CASH || 0.10),
    transfer: Number(process.env.DISCOUNT_TRANSFER || 0.05)
  },

  business: {
    budgetValidityDays: Number(process.env.BUDGET_VALIDITY_DAYS || 1),
    pdfFooterText: process.env.PDF_FOOTER_TEXT || 'Validez: 1 día.'
  }
};