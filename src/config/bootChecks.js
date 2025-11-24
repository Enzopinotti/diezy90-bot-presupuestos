// src/config/bootChecks.js
import { logger } from './logger.js';
import { env } from './env.js';

export function bootChecks() {
  const mask = (s='') => (s?.length ? `${s.slice(0,4)}…${s.slice(-4)}` : 'missing');
  logger.info({
    watiBaseUrl: env.wati.baseUrl || 'missing',
    watiApiKey: mask(env.wati.apiKey),
    templateWelcome: env.wati.templateWelcome || '(none)',
  }, 'Boot: env sanity');
}
