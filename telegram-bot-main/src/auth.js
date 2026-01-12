import { getDb } from "./db.js";
import { getKv } from "./kv.js";
import { tgCall } from "./telegram.js";
import { nowSec } from "./utils.js";

function buildCacheKey(userId, chatKey) {
  return `vip_chat_member:${chatKey}:${userId}`;
}

function buildChatKey(chatIds) {
  const raw = chatIds.join(",");
  return raw ? btoa(raw).replace(/=+$/, "") : "none";
}

async function getVipChatIds(env) {
  const rows = await getDb(env).prepare(
    "SELECT chat_id FROM managed_chats WHERE is_enabled=1 ORDER BY chat_id ASC"
  ).all();
  return (rows.results || [])
    .map((row) => Number(row.chat_id))
    .filter((id) => Number.isFinite(id));
}

export async function isMember(env, userId) {
  if (!Number.isFinite(userId)) return false;
  const chatIds = await getVipChatIds(env);
  if (!chatIds.length) return false;
  const chatKey = buildChatKey(chatIds);
  const kv = getKv(env);
  const cacheKey = buildCacheKey(userId, chatKey);
  const cached = kv ? await kv.get(cacheKey) : null;
  if (cached === "1") return true;
  if (cached === "0") return false;

  let isVip = false;
  for (const chatId of chatIds) {
    try {
      const member = await tgCall(env, "getChatMember", { chat_id: chatId, user_id: userId });
      const status = member?.status;
      if (["creator", "administrator", "member", "restricted"].includes(status)) {
        isVip = true;
        break;
      }
    } catch {
      // ignore lookup failures
    }
  }

  if (kv) {
    const ttl = isVip ? 6 * 3600 : 30 * 60;
    await kv.put(cacheKey, isVip ? "1" : "0", { expirationTtl: ttl });
  }
  return isVip;
}

export async function checkDailyDmLimit(env, userId, isAdmin) {
  if (isAdmin) return { allowed: true, remaining: null };
  const member = await isMember(env, userId);
  const limit = member ? 100 : 10;
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: env.TZ || "Asia/Shanghai" }).format(
    new Date(nowSec() * 1000)
  );
  const key = `dm_count:${dayKey}:${userId}`;
  const current = Number(await getKv(env).get(key) || 0);
  if (current >= limit) return { allowed: false, remaining: 0, limit };
  await getKv(env).put(key, String(current + 1), { expirationTtl: 2 * 86400 });
  return { allowed: true, remaining: limit - current - 1, limit };
}
