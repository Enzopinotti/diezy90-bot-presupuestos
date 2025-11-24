// src/middlewares/errorHandler.js
// Manejo de errores genérico sin romper si ya respondimos antes
export function errorHandler(err, req, res, next) {
  req.log?.error({ err }, 'Unhandled error');
  if (res.headersSent) {
    // Ya se envió respuesta (por ejemplo, ACK de webhook). No intentes responder de nuevo.
    return next(err);
  }
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message || 'Internal error' });
}
