// src/middlewares/requestLog.js
import { nanoid } from 'nanoid';
import { logger } from '../config/logger.js';

export function requestLog(req, res, next) {
  req.rid = nanoid(8);
  req.log = logger.child({ rid: req.rid, path: req.path, method: req.method });

  // log del body (post JSON ya parseado por express.json/body-parser)
  req.log.debug({
    headers: {
      'user-agent': req.headers['user-agent'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
    },
    bodyPreview: JSON.stringify(req.body || {}).slice(0, 800)
  }, 'HTTP IN');

  const t0 = Date.now();
  res.on('finish', () => {
    req.log.debug({ status: res.statusCode, ms: Date.now() - t0 }, 'HTTP OUT');
  });
  next();
}
