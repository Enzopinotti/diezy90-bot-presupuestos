// /src/server.js
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import './config/redis.js'; // inicializa conexión

process.on('unhandledRejection', (r) => logger.error({ r }, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
  logger.error({ e }, 'uncaughtException');
  process.exit(1);
});

const app = createApp();
app.listen(env.port, () => {
  logger.info(`Server listening on :${env.port}`);
});