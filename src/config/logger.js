// src/config/logger.js
import pino from 'pino';
const isDev = process.env.NODE_ENV !== 'production';

let destination;
if (isDev) {
  try {
    destination = pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } });
  } catch {
    destination = undefined; // sigue plano
  }
}
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  base: null,
  redact: ['env.wati.apiKey', 'headers.authorization', 'Authorization']
}, destination);
