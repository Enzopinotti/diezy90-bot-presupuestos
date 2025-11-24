// src/app.js
import 'express-async-errors';
import express from 'express';
import bodyParser from 'body-parser';
import { routes } from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLog } from './middlewares/requestLog.js';
import { debug } from './routes/debug.js';

export function createApp() {
  const app = express();

  // Parsers primero para poder loguear body ya parseado
  app.use(bodyParser.json({ limit: '5mb' }));
  app.use(bodyParser.urlencoded({ extended: true }));

  // Rutas utilitarias de debug
  app.use(debug);

  // Logging por request
  app.use(requestLog);

  // Rutas principales
  app.use(routes);

  // Manejo de errores al final
  app.use(errorHandler);

  return app;
}
