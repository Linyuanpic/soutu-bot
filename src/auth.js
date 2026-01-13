import { DAILY_SEARCH_RESET_HOUR } from "./config.js";
import { getDb, getMembership } from "./db.js";
import { getKv } from "./kv.js";
import { nowSec, getTzDateKey, getTzDateKeyWithOffset } from "./utils.js";

function getVipListDayKey(env) {
  return getTzDateKeyWithOffset(nowSec(), env.TZ, DAILY_SEARCH_RESET_HOUR);
}

function getVipListCacheKey(dayKey) {
  return `vip_list:${dayKey}`;
}

async function readVipListCache(env, dayKey) {
  const kv = getKv(env);
  if (!kv) return null;
  const raw = await kv.get(getVipListCacheKey(dayKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function writeVipListCache(env, dayKey, list) {
  const kv = getKv(env);
  if (!kv) return;
  await kv.put(getVipListCacheKey(dayKey), JSON.stringify(list), { expirationTtl: 24 * 86400 });
}

async function fetchVipList(env) {
  const rows = await getDb(env).prepare(
    `SELECT user_id FROM memberships WHERE expire_at > ?`
  ).bind(nowSec()).all();
  return (rows.results || []).map(row => Number(row.user_id)).filter(Number.isFinite);
}

async function ensureVipListCache(env) {
  const kv = getKv(env);
  if (!kv) return null;
  const dayKey = getVipListDayKey(env);
  const cached = await readVipListCache(env, dayKey);
  if (cached) return { dayKey, list: cached };
  const list = await fetchVipList(env);
  await writeVipListCache(env, dayKey, list);
  return { dayKey, list };
}

export async function updateVipListCache(env, userId, isMember) {
  if (!Number.isFinite(userId)) return;
  const kv = getKv(env);
  if (!kv) return;
  const result = await ensureVipListCache(env);
  if (!result) return;
  const { dayKey, list } = result;
  const set = new Set(list);
  if (isMember) {
    set.add(userId);
  } else {
    set.delete(userId);
  }
  await writeVipListCache(env, dayKey, Array.from(set));
}

export async function isMember(env, userId) {
  if (!Number.isFinite(userId)) return false;
  const kv = getKv(env);
  if (kv) {
    const cached = await ensureVipListCache(env);
    if (cached?.list) return cached.list.includes(userId);
  }
  const m = await getMembership(env, userId);
  return !!(m && m.expire_at > nowSec());
}

export async function addMembershipDays(env, userId, days) {
  const t = nowSec();
  const m = await getMembership(env, userId);
  const base = m ? Math.max(t, m.expire_at) : t;
  const expire = base + days * 86400;
  if (m) {
    await getDb(env).prepare(`UPDATE memberships SET expire_at=?, updated_at=? WHERE user_id=?`).bind(expire, t, userId).run();
  } else {
    await getDb(env).prepare(`INSERT INTO memberships(user_id, verified_at, expire_at, updated_at) VALUES (?,?,?,?)`)
      .bind(userId, t, expire, t).run();
  }
  await updateVipListCache(env, userId, true);
  await getDb(env).prepare(`DELETE FROM expired_users WHERE user_id=?`).bind(userId).run();
  return { wasMember: !!(m && m.expire_at > t), expire_at: expire };
}

export async function ensureMembershipThrough(env, userId, expireAt) {
  const t = nowSec();
  const targetExpire = Number(expireAt);
  if (!Number.isFinite(userId) || !Number.isFinite(targetExpire)) return null;
  const m = await getMembership(env, userId);
  if (m && m.expire_at >= targetExpire) return { updated: false, expire_at: m.expire_at };
  if (m) {
    await getDb(env).prepare(`UPDATE memberships SET expire_at=?, updated_at=? WHERE user_id=?`).bind(targetExpire, t, userId).run();
  } else {
    await getDb(env).prepare(`INSERT INTO memberships(user_id, verified_at, expire_at, updated_at) VALUES (?,?,?,?)`)
      .bind(userId, t, targetExpire, t).run();
  }
  await updateVipListCache(env, userId, true);
  await getDb(env).prepare(`DELETE FROM expired_users WHERE user_id=?`).bind(userId).run();
  return { updated: true, expire_at: targetExpire };
}

export async function checkDailyDmLimit(env, userId, isAdmin) {
  if (isAdmin) return { allowed: true, remaining: null };
  const member = await isMember(env, userId);
  const limit = member ? 100 : 10;
  const dayKey = getTzDateKey(nowSec(), env.TZ);
  const key = `dm_count:${dayKey}:${userId}`;
  const current = Number(await getKv(env).get(key) || 0);
  if (current >= limit) return { allowed: false, remaining: 0, limit };
  await getKv(env).put(key, String(current + 1), { expirationTtl: 2 * 86400 });
  return { allowed: true, remaining: limit - current - 1, limit };
}

export async function syncVipCache(env) {
  const kv = getKv(env);
  if (!kv) return;
  const dayKey = getVipListDayKey(env);
  const syncKey = `vip_list_sync:${dayKey}`;
  if (await kv.get(syncKey)) return;
  const list = await fetchVipList(env);
  await writeVipListCache(env, dayKey, list);
  await kv.put(syncKey, "1", { expirationTtl: 2 * 86400 });
}

export async function syncExpiredUsers(env) {
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO expired_users(user_id, expired_at, updated_at)
     SELECT user_id, expire_at, ?
     FROM memberships
     WHERE expire_at <= ?
     ON CONFLICT(user_id) DO UPDATE SET expired_at=excluded.expired_at, updated_at=excluded.updated_at`
  ).bind(t, t).run();
  await getDb(env).prepare(
    `DELETE FROM expired_users
     WHERE user_id IN (SELECT user_id FROM memberships WHERE expire_at > ?)`
  ).bind(t).run();
}
