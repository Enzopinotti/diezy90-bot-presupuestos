// /src/middlewares/errorHandler.js
import { logger } from '../config/logger.js';

export function errorHandler(err, req, res, _next) {
  logger.error({ err }, 'Unhandled error');
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Error interno'
  });
}