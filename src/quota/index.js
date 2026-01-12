import { GROUP_DAILY_LIMIT, PRIVATE_DAILY_LIMIT } from "../config.js";
import { kvGet, kvPut } from "../storage/kv.js";
import { getTzDateKey, nowSec } from "../utils.js";

function buildKey(prefix, userId, tz) {
  const dayKey = getTzDateKey(nowSec(), tz);
  return `${prefix}:${userId}:${dayKey}`;
}

async function bumpQuota(env, key, limit, ttlSec) {
  const current = Number(await kvGet(env, key) || 0);
  if (current >= limit) return { allowed: false, current, limit };
  const next = current + 1;
  await kvPut(env, key, String(next), { expirationTtl: ttlSec });
  return { allowed: true, current: next, limit };
}

export async function checkGroupQuota(env, userId) {
  const key = buildKey("quota", userId, env.TZ || "Asia/Shanghai");
  return bumpQuota(env, key, GROUP_DAILY_LIMIT, 24 * 60 * 60);
}

export async function checkPrivateQuota(env, userId) {
  const key = buildKey("private_quota", userId, env.TZ || "Asia/Shanghai");
  return bumpQuota(env, key, PRIVATE_DAILY_LIMIT, 24 * 60 * 60);
}
