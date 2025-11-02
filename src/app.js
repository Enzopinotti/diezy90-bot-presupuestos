// src/app.js
import 'express-async-errors';
import express from 'express';
import bodyParser from 'body-parser';
import { routes } from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '5mb' }));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(routes);
  app.use(errorHandler);
  return app;
}
