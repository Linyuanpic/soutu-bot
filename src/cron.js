import { GROUP_MEMBER_EXPIRE_DAYS } from "./config.js";
import { getDb, listManagedChats, markUserChatRemoved, validateEnv } from "./db.js";
import { ensureMembershipThrough } from "./auth.js";
import { tgCall } from "./telegram.js";
import { nowSec } from "./utils.js";

const SCAN_RATE_PER_SECOND = 10;
const SCAN_DELAY_MS = Math.ceil(1000 / SCAN_RATE_PER_SECOND);

async function scanManagedChatMembers(env) {
  const chats = await listManagedChats(env, true);
  for (const chat of chats) {
    const rows = await getDb(env).prepare(
      `SELECT user_id FROM user_chats WHERE chat_id=? AND removed_at IS NULL ORDER BY approved_at DESC`
    ).bind(chat.chat_id).all();
    const users = rows.results || [];
    for (const row of users) {
      try {
        const info = await tgCall(env, "getChatMember", { chat_id: chat.chat_id, user_id: row.user_id });
        const status = info?.status || "";
        if (["member", "administrator", "creator", "restricted"].includes(status)) {
          const expireAt = nowSec() + GROUP_MEMBER_EXPIRE_DAYS * 86400;
          await ensureMembershipThrough(env, row.user_id, expireAt);
        } else if (["left", "kicked"].includes(status)) {
          await markUserChatRemoved(env, row.user_id, chat.chat_id);
        }
      } catch (e) {
        const code = Number(e.tg?.error_code || e.status || 0);
        if ([400, 403].includes(code)) {
          await markUserChatRemoved(env, row.user_id, chat.chat_id);
        }
      }
      await new Promise(res => setTimeout(res, SCAN_DELAY_MS));
    }
  }
}

export async function scheduled(event, env, ctx) {
  const envIssues = validateEnv(env);
  if (envIssues.length) return;
  ctx.waitUntil(scanManagedChatMembers(env));
}
