// src/services/sessionService.js
// ----------------------------------------------------
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

const SESSION_TTL_SEC  = Number(env.session?.ttlHours || process.env.SESSION_TTL_HOURS || 24) * 3600;
const SNAPSHOT_TTL_SEC = Number(process.env.SNAPSHOT_TTL_DAYS || 7) * 24 * 3600;

const kSess = phone => `d90:sess:${phone}`;
const kSeen = msgId => `d90:seen:${msgId}`;          // idempotencia
const kSnap = phone => `d90:snap:${phone}`;          // snapshot último presupuesto

export async function getSession(phone) {
  const raw = await redis.get(kSess(phone));
  return raw ? JSON.parse(raw) : null;
}
export async function setSession(phone, data) {
  const withMeta = { ...data, updatedAt: Date.now(), version: (data?.version || 1) };
  await redis.set(kSess(phone), JSON.stringify(withMeta), 'EX', SESSION_TTL_SEC);
  return withMeta;
}
export async function clearSession(phone) { await redis.del(kSess(phone)); }
export async function bumpSession(phone) {
  const raw = await redis.get(kSess(phone));
  if (raw) await redis.set(kSess(phone), raw, 'EX', SESSION_TTL_SEC);
}

/** Guarda un snapshot liviano para poder reanudar luego de expirar/cerrar. */
export async function saveSnapshot(phone, snapshot) {
  const days = Number(env?.business?.budgetValidityDays ?? 1);
  const now = Date.now();
  const data = {
    ...snapshot,
    savedAt: now,
    expiresAt: now + days*24*60*60*1000, 
    budgetValidityDays: days
  };
  await redis.set(kSnap(phone), JSON.stringify(data), 'EX', SNAPSHOT_TTL_SEC);
  return data;
}
export async function getSnapshot(phone) {
  const raw = await redis.get(kSnap(phone));
  return raw ? JSON.parse(raw) : null;
}
export async function clearSnapshot(phone) { await redis.del(kSnap(phone)); }

/** Idempotencia simple por messageId. Devuelve true si es nuevo. */
export async function markInboundIfNew(messageId, ttlSeconds = 24 * 3600) {
  if (!messageId) return true;
  const ok = await redis.set(kSeen(messageId), '1', 'NX', 'EX', ttlSeconds);
  return ok === 'OK';
}