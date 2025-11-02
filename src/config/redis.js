//src/config/redis.js
import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.redisUrl);
redis.on('connect', () => logger.info('Redis conectado'));
redis.on('error', (e) => logger.error({ e }, 'Redis error'));