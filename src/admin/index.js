import { JSON_HEADERS, TEMPLATE_TYPES } from "../config.js";
import { nowSec, pickRandom, readJsonBody } from "../utils.js";
import { tgCall } from "../telegram.js";

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: JSON_HEADERS });
}

async function isAdmin(env, req) {
  const token = req.headers.get("authorization") || "";
  const expected = env.ADMIN_TOKEN || "";
  if (!expected) return false;
  if (token === `Bearer ${expected}`) return true;
  return false;
}

export async function handleAdminApi(env, req, path) {
  if (!(await isAdmin(env, req))) return unauthorized();

  if (path === "/admin/stats" && req.method === "GET") {
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const totalUsers = await env.DB.prepare("SELECT COUNT(DISTINCT user_id) as total FROM search_logs").first();
    const weekNewUsers = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT user_id, MIN(date(timestamp, 'unixepoch')) as first_date
        FROM search_logs
        GROUP BY user_id
      ) WHERE first_date >= date('now', '-6 days')`
    ).first();
    const monthNewUsers = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT user_id, MIN(date(timestamp, 'unixepoch')) as first_date
        FROM search_logs
        GROUP BY user_id
      ) WHERE first_date >= date('now', 'start of month')`
    ).first();
    const weekSearchUsers = await env.DB.prepare(
      "SELECT COUNT(DISTINCT user_id) as total FROM search_logs WHERE date(timestamp, 'unixepoch') >= date('now', '-6 days')"
    ).first();
    const monthSearchUsers = await env.DB.prepare(
      "SELECT COUNT(DISTINCT user_id) as total FROM search_logs WHERE date(timestamp, 'unixepoch') >= date('now', 'start of month')"
    ).first();
    const weekSearchCount = await env.DB.prepare(
      "SELECT COUNT(*) as total FROM search_logs WHERE date(timestamp, 'unixepoch') >= date('now', '-6 days')"
    ).first();
    const monthSearchCount = await env.DB.prepare(
      "SELECT COUNT(*) as total FROM search_logs WHERE date(timestamp, 'unixepoch') >= date('now', 'start of month')"
    ).first();
    const totalMembers = await env.DB.prepare("SELECT COUNT(*) as total FROM members WHERE status='active'").first();
    const weekNewMembers = await env.DB.prepare(
      "SELECT COUNT(*) as total FROM members WHERE status='active' AND date(updated_at, 'unixepoch') >= date('now', '-6 days')"
    ).first();
    const monthNewMembers = await env.DB.prepare(
      "SELECT COUNT(*) as total FROM members WHERE status='active' AND date(updated_at, 'unixepoch') >= date('now', 'start of month')"
    ).first();

    const newUserRows = await env.DB.prepare(
      `SELECT first_date as day, COUNT(*) as total FROM (
        SELECT user_id, MIN(date(timestamp, 'unixepoch')) as first_date
        FROM search_logs
        GROUP BY user_id
      ) WHERE first_date >= date('now', '-6 days')
      GROUP BY first_date`
    ).all();
    const newMemberRows = await env.DB.prepare(
      "SELECT date(updated_at, 'unixepoch') as day, COUNT(*) as total FROM members WHERE status='active' AND date(updated_at, 'unixepoch') >= date('now', '-6 days') GROUP BY day"
    ).all();
    const searchRows = await env.DB.prepare(
      "SELECT date(timestamp, 'unixepoch') as day, COUNT(*) as total, COUNT(DISTINCT user_id) as users FROM search_logs WHERE date(timestamp, 'unixepoch') >= date('now', '-6 days') GROUP BY day"
    ).all();

    const mapByDay = (rows, key = "total") => {
      const map = new Map();
      (rows.results || []).forEach(row => map.set(row.day, row[key]));
      return days.map(day => map.get(day) || 0);
    };

    const searchMap = new Map();
    (searchRows.results || []).forEach(row => {
      searchMap.set(row.day, row);
    });

    const searchCounts = days.map(day => (searchMap.get(day)?.total || 0));
    const searchUsers = days.map(day => (searchMap.get(day)?.users || 0));

    const data = {
      summary: {
        users_total: totalUsers?.total || 0,
        users_week_new: weekNewUsers?.total || 0,
        users_month_new: monthNewUsers?.total || 0,
        searches_week_users: weekSearchUsers?.total || 0,
        searches_month_users: monthSearchUsers?.total || 0,
        members_total: totalMembers?.total || 0,
        members_week_new: weekNewMembers?.total || 0,
        members_month_new: monthNewMembers?.total || 0,
        searches_week_count: weekSearchCount?.total || 0,
        searches_month_count: monthSearchCount?.total || 0,
      },
      series: {
        days,
        new_users: mapByDay(newUserRows),
        new_members: mapByDay(newMemberRows),
        search_counts: searchCounts,
        search_users: searchUsers,
      },
    };

    return new Response(JSON.stringify({ ok: true, data }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/templates" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, key, type, content, buttons, is_enabled FROM templates ORDER BY id DESC").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/templates" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body?.key || !body?.type) {
      return new Response(JSON.stringify({ ok: false, error: "missing key/type" }), { status: 400, headers: JSON_HEADERS });
    }
    const buttons = JSON.stringify(body.buttons || []);
    await env.DB.prepare(
      `INSERT INTO templates(key, type, content, buttons, is_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         type=excluded.type,
         content=excluded.content,
         buttons=excluded.buttons,
         is_enabled=excluded.is_enabled,
         updated_at=excluded.updated_at`
    ).bind(body.key, body.type, body.content || "", buttons, body.is_enabled ? 1 : 0, nowSec()).run();
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/members" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT user_id, expires_at, source_group, status, updated_at FROM members ORDER BY updated_at DESC LIMIT 200").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/broadcasts" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, content, sent_at, sent_count FROM broadcasts ORDER BY sent_at DESC LIMIT 50").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/broadcasts" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body?.content) {
      return new Response(JSON.stringify({ ok: false, error: "missing content" }), { status: 400, headers: JSON_HEADERS });
    }
    const sentAt = nowSec();
    const res = await env.DB.prepare("INSERT INTO broadcasts(content, sent_at, sent_count) VALUES (?, ?, 0)").bind(body.content, sentAt).run();
    const broadcastId = res.meta.last_row_id;
    const members = await env.DB.prepare("SELECT user_id FROM members WHERE status='active'").all();
    let sentCount = 0;
    for (const row of members.results || []) {
      try {
        await tgCall(env, "sendMessage", { chat_id: row.user_id, text: body.content });
        sentCount += 1;
      } catch {
        // ignore
      }
    }
    await env.DB.prepare("UPDATE broadcasts SET sent_count=? WHERE id=?").bind(sentCount, broadcastId).run();
    return new Response(JSON.stringify({ ok: true, sent_count: sentCount }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/vip-groups" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT chat_id, name FROM vip_groups ORDER BY chat_id DESC").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/admin/vip-groups" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body?.chat_id) {
      return new Response(JSON.stringify({ ok: false, error: "missing chat_id" }), { status: 400, headers: JSON_HEADERS });
    }
    await env.DB.prepare(
      `INSERT INTO vip_groups(chat_id, name) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET name=excluded.name`
    ).bind(body.chat_id, body.name || "").run();
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404, headers: JSON_HEADERS });
}

export async function pickSearchTemplate(env) {
  const rows = await env.DB.prepare(
    "SELECT key, content, buttons FROM templates WHERE type=? AND is_enabled=1"
  ).bind(TEMPLATE_TYPES.SEARCH_REPLY).all();
  return pickRandom(rows.results || []);
}

export async function getTemplateByKey(env, key) {
  return env.DB.prepare("SELECT key, content, buttons FROM templates WHERE key=? AND is_enabled=1").bind(key).first();
}
