//src/config/logger.js
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  name: 'd90-bot',
  level: env.node === 'production' ? 'info' : 'debug',
  transport: env.node === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' }
  }
});