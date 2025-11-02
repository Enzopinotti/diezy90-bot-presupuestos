// /src/services/sessionService.js
import { redis } from '../config/redis.js';

const SESSION_TTL = 60 * 60 * 24; // 24 horas

function key(phone) { return `d90:sess:${phone}`; }

export async function getSession(phone) {
  const raw = await redis.get(key(phone));
  return raw ? JSON.parse(raw) : null;
}

export async function setSession(phone, data) {
  await redis.set(key(phone), JSON.stringify(data), 'EX', SESSION_TTL);
  return data;
}

export async function clearSession(phone) {
  await redis.del(key(phone));
}

export async function bumpSession(phone) {
  const raw = await redis.get(key(phone));
  if (raw) await redis.set(key(phone), raw, 'EX', SESSION_TTL);
}