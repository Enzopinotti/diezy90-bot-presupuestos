// /src/middlewares/verifyWatiSignature.js
/**
 * Placeholder de verificación de firma WATI (si aplica).
 * Si WATI envía un header con HMAC, validar aquí con WATI_WEBHOOK_SECRET.
 */
export function verifyWatiSignature(req, _res, next) {
  // TODO: implementar si se requiere.
  return next();
}