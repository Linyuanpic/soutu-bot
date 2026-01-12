import { tgCall } from "../telegram.js";
import { nowSec } from "../utils.js";

export async function listVipGroups(env) {
  const rows = await env.DB.prepare("SELECT chat_id, name FROM vip_groups").all();
  return rows.results || [];
}

export async function isMember(env, userId) {
  const vipGroups = await listVipGroups(env);
  for (const group of vipGroups) {
    try {
      const member = await tgCall(env, "getChatMember", {
        chat_id: group.chat_id,
        user_id: userId,
      });
      if (["creator", "administrator", "member", "restricted"].includes(member?.status)) {
        await upsertMember(env, userId, group.chat_id, "active");
        return true;
      }
    } catch {
      // ignore and continue
    }
  }
  await upsertMember(env, userId, null, "inactive");
  return false;
}

export async function upsertMember(env, userId, sourceGroup, status) {
  const ts = nowSec();
  await env.DB.prepare(
    `INSERT INTO members(user_id, expires_at, source_group, status, updated_at)
     VALUES (?, NULL, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       source_group=excluded.source_group,
       status=excluded.status,
       updated_at=excluded.updated_at`
  ).bind(userId, sourceGroup, status, ts).run();
}
