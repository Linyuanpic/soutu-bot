import { JSON_HEADERS, TEMPLATE_TYPES } from "../config.js";
import { nowSec, pickRandom, readJsonBody } from "../utils.js";
import { tgCall } from "../telegram.js";

const ADMIN_USER_IDS = [7204268059];

function parseAdminIds(env) {
  const raw = env?.ADMIN_USER_IDS;
  if (!raw) return ADMIN_USER_IDS;
  return raw
    .split(",")
    .map(value => Number(value.trim()))
    .filter(Number.isFinite);
}

function getKv(env) {
  return env.KV;
}

export async function handleAdminLoginCommand(env, msg, origin) {
  const adminIds = parseAdminIds(env);
  const fromId = msg.from?.id;
  if (!adminIds.includes(fromId)) return;
  const token = crypto.randomUUID().replaceAll("-", "");
  await getKv(env).put(`admin_login_token:${token}`, String(fromId), { expirationTtl: 600 });
  const loginUrl = `${origin}/admin?token=${encodeURIComponent(token)}`;
  await tgCall(env, "sendMessage", {
    chat_id: fromId,
    text: `后台登录链接（10分钟内有效）：\n<a href="${loginUrl}">${loginUrl}</a>\n打开后将自动登录后台。该链接仅可使用一次。`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function isAdminSession(env, req) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/admin_session=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const token = match[1];
  const uid = await getKv(env).get(`admin_session:${token}`);
  if (!uid) return null;
  return Number(uid);
}

export async function createAdminSession(env, userId) {
  const token = crypto.randomUUID().replaceAll("-", "");
  await getKv(env).put(`admin_session:${token}`, String(userId), { expirationTtl: 7 * 24 * 3600 });
  return token;
}

export async function consumeAdminLoginToken(env, token) {
  if (!token) return null;
  const uidStr = await getKv(env).get(`admin_login_token:${token}`);
  if (!uidStr) return null;
  const userId = Number(uidStr);
  const adminIds = parseAdminIds(env);
  if (!adminIds.includes(userId)) return null;
  await getKv(env).delete(`admin_login_token:${token}`);
  return userId;
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: JSON_HEADERS });
}

export function loginHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>搜图机器人后台</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#f1f5f9;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh}
    .card{background:#fff;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,0.12);max-width:420px;text-align:center}
    .title{font-size:22px;font-weight:700;margin-bottom:12px}
    .desc{color:#64748b;line-height:1.6}
    .hint{margin-top:16px;font-weight:600;color:#2563eb}
  </style>
</head>
<body>
  <div class="card">
    <div class="title">后台登录</div>
    <div class="desc">请在 Telegram 与机器人私聊发送 <strong>/login</strong> 获取登录链接。</div>
    <div class="hint">仅管理员可登录</div>
  </div>
</body>
</html>`;
}

export function adminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>搜图机器人后台</title>
  <style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{margin:0;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#f1f5f9;color:#0f172a}
    h1,h2,h3{margin:0}
    p{margin:0;color:#64748b}
    .topbar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #e2e8f0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px}
    .brand{display:flex;align-items:center;gap:16px}
    .brand-icon{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#60a5fa,#38bdf8);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
    .nav-tabs{display:flex;gap:10px;flex-wrap:wrap}
    .nav-tabs button{border:1px solid transparent;background:#f1f5f9;border-radius:999px;padding:8px 16px;font-weight:600;color:#475569;cursor:pointer}
    .nav-tabs button.active{background:#1d4ed8;color:#fff}
    main{padding:24px 28px 40px;display:flex;flex-direction:column;gap:24px}
    .tab.hidden{display:none}
    .section-header{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .tag{background:#e0e7ff;color:#3730a3;padding:6px 12px;border-radius:999px;font-weight:600;font-size:12px}
    .metric-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
    .panel{background:#fff;border-radius:18px;padding:20px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
    .panel h3{font-size:16px;margin-bottom:12px}
    .metric-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
    .metric{display:flex;flex-direction:column;gap:6px;background:#f8fafc;border-radius:14px;padding:12px}
    .metric strong{font-size:20px}
    .chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
    .chart{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;align-items:end;height:180px;margin-top:12px}
    .chart-bar{display:flex;flex-direction:column;gap:4px;height:140px;justify-content:flex-end}
    .bar{width:100%;border-radius:6px 6px 0 0}
    .bar.primary{background:#3b82f6}
    .bar.accent{background:#f97316}
    .bar-label{text-align:center;font-size:12px;color:#64748b;margin-top:8px}
    .chart-legend{display:flex;gap:16px;font-size:12px;color:#64748b;margin-top:12px}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%}
    .dot-primary{background:#3b82f6}
    .dot-accent{background:#f97316}
    .panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .panel-subtitle{font-size:12px;color:#94a3b8}
    .form-panel form{display:flex;flex-direction:column;gap:16px}
    .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
    .form-span{grid-column:1/-1}
    input,textarea,select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid #cbd5e1;font-size:14px;background:#fff}
    textarea{min-height:120px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace}
    .form-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .switch{display:flex;align-items:center;gap:8px;font-size:14px;color:#475569}
    .switch input{width:auto}
    button.primary{background:#1d4ed8;color:#fff;border:none;padding:10px 18px;border-radius:12px;font-weight:600;cursor:pointer}
    .table-wrap{overflow:auto}
    .data-table{width:100%;border-collapse:collapse}
    .data-table th,.data-table td{border-bottom:1px solid #e2e8f0;padding:10px 8px;text-align:left;font-size:14px}
    .data-table th{color:#64748b;font-weight:600}
    .muted{color:#94a3b8;text-align:center}
    .pill{display:inline-flex;background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:999px;font-size:12px}
    @media (max-width:720px){
      .topbar{flex-direction:column;align-items:flex-start}
      .nav-tabs{width:100%}
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-icon">搜图</div>
      <div>
        <h1>搜图机器人后台</h1>
        <p>清晰的数据看板与高效运营管理</p>
      </div>
    </div>
    <nav class="nav-tabs">
      <button data-tab="dashboard" class="active">数据看板</button>
      <button data-tab="templates">模板管理</button>
      <button data-tab="members">会员列表</button>
      <button data-tab="broadcast">群发消息</button>
    </nav>
  </header>

  <main>
    <section id="dashboard" class="tab">
      <div class="section-header">
        <div>
          <h2>数据看板</h2>
          <p>实时掌握用户与搜图活跃趋势</p>
        </div>
        <div class="tag">最近 7 天</div>
      </div>

      <div class="metric-panels">
        <div class="panel">
          <h3>用户数据</h3>
          <div class="metric-list">
            <div class="metric"><span>全部用户</span><strong id="usersTotal">0</strong></div>
            <div class="metric"><span>本周新增用户</span><strong id="usersWeekNew">0</strong></div>
            <div class="metric"><span>本月新增用户</span><strong id="usersMonthNew">0</strong></div>
            <div class="metric"><span>本周搜图人数</span><strong id="searchUsersWeek">0</strong></div>
            <div class="metric"><span>本月搜图人数</span><strong id="searchUsersMonth">0</strong></div>
          </div>
        </div>
        <div class="panel">
          <h3>会员数据</h3>
          <div class="metric-list">
            <div class="metric"><span>会员用户</span><strong id="membersTotal">0</strong></div>
            <div class="metric"><span>本周新增会员</span><strong id="membersWeekNew">0</strong></div>
            <div class="metric"><span>本月新增会员</span><strong id="membersMonthNew">0</strong></div>
            <div class="metric"><span>本周搜图数量</span><strong id="searchCountWeek">0</strong></div>
            <div class="metric"><span>本月搜图数量</span><strong id="searchCountMonth">0</strong></div>
          </div>
        </div>
      </div>

      <div class="chart-grid">
        <div class="panel">
          <div class="panel-header">
            <h3>近一周新增用户 / 会员</h3>
            <span class="panel-subtitle">双柱图</span>
          </div>
          <div id="chartNewUsers" class="chart"></div>
          <div class="chart-legend">
            <span><i class="dot dot-primary"></i>新增用户</span>
            <span><i class="dot dot-accent"></i>新增会员</span>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">
            <h3>近一周搜图数量与人数</h3>
            <span class="panel-subtitle">双柱图</span>
          </div>
          <div id="chartSearches" class="chart"></div>
          <div class="chart-legend">
            <span><i class="dot dot-primary"></i>搜图数量</span>
            <span><i class="dot dot-accent"></i>搜图人数</span>
          </div>
        </div>
      </div>
    </section>

    <section id="templates" class="tab hidden">
      <div class="section-header">
        <div>
          <h2>模板管理</h2>
          <p>调整消息模版内容，统一回复格式</p>
        </div>
      </div>
      <div class="panel form-panel">
        <form id="templateForm">
          <div class="form-grid">
            <label>模版 Key
              <input name="key" placeholder="如：welcome_message" required />
            </label>
            <label>模版类型
              <select name="type">
                <option value="search_reply">搜图回复</option>
                <option value="auto_reply">自动回复</option>
              </select>
            </label>
            <label class="form-span">回复内容
              <textarea name="content" placeholder="输入要发送的消息内容"></textarea>
            </label>
            <label class="form-span">按钮配置（JSON）
              <textarea name="buttons">[]</textarea>
            </label>
          </div>
          <div class="form-actions">
            <label class="switch">
              <input type="checkbox" name="is_enabled" checked />
              <span>启用模版</span>
            </label>
            <button type="submit" class="primary">保存模版</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3>模版列表</h3>
          <span class="panel-subtitle">最新记录</span>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="templateTable">
            <thead>
              <tr>
                <th>Key</th>
                <th>类型</th>
                <th>启用</th>
                <th>内容</th>
                <th>按钮</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="members" class="tab hidden">
      <div class="section-header">
        <div>
          <h2>会员列表</h2>
          <p>查看最近更新的会员信息</p>
        </div>
      </div>
      <div class="panel">
        <div class="table-wrap">
          <table class="data-table" id="memberTable">
            <thead>
              <tr>
                <th>用户 ID</th>
                <th>到期时间</th>
                <th>来源群组</th>
                <th>状态</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="broadcast" class="tab hidden">
      <div class="section-header">
        <div>
          <h2>群发消息</h2>
          <p>一键触达全部会员用户</p>
        </div>
      </div>
      <div class="panel form-panel">
        <form id="broadcastForm">
          <label>群发内容
            <textarea name="content" placeholder="输入群发内容" required></textarea>
          </label>
          <button type="submit" class="primary">发送群发</button>
        </form>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3>群发记录</h3>
          <span class="panel-subtitle">最近 50 条</span>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="broadcastTable">
            <thead>
              <tr>
                <th>内容</th>
                <th>发送时间</th>
                <th>送达人数</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>
  </main>

  <script>
    function setTab(tab) {
      document.querySelectorAll(".tab").forEach(section => {
        section.classList.toggle("hidden", section.id !== tab);
      });
      document.querySelectorAll(".nav-tabs button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
      });
    }

    document.querySelectorAll(".nav-tabs button").forEach(btn => {
      btn.addEventListener("click", () => {
        setTab(btn.dataset.tab);
      });
    });

    const fallbackDays = (() => {
      const today = new Date();
      const list = [];
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        list.push(d.toISOString().slice(0, 10));
      }
      return list;
    })();

    const fallbackData = {
      summary: {
        users_total: 0,
        users_week_new: 0,
        users_month_new: 0,
        searches_week_users: 0,
        searches_month_users: 0,
        members_total: 0,
        members_week_new: 0,
        members_month_new: 0,
        searches_week_count: 0,
        searches_month_count: 0,
      },
      series: {
        days: fallbackDays,
        new_users: Array(7).fill(0),
        new_members: Array(7).fill(0),
        search_counts: Array(7).fill(0),
        search_users: Array(7).fill(0),
      },
    };

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    function renderChart(containerId, days, seriesA, seriesB) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const max = Math.max(...seriesA, ...seriesB, 1);
      container.innerHTML = days.map((day, index) => {
        const a = seriesA[index] || 0;
        const b = seriesB[index] || 0;
        const aHeight = Math.round((a / max) * 100);
        const bHeight = Math.round((b / max) * 100);
        return '<div>' +
          '<div class="chart-bar">' +
            '<div class="bar primary" style="height:' + aHeight + '%"></div>' +
            '<div class="bar accent" style="height:' + bHeight + '%"></div>' +
          '</div>' +
          '<div class="bar-label">' + day.slice(5) + '</div>' +
        '</div>';
      }).join("");
    }

    function renderDashboard(data) {
      const summary = data.summary || fallbackData.summary;
      const series = data.series || fallbackData.series;
      setText("usersTotal", summary.users_total);
      setText("usersWeekNew", summary.users_week_new);
      setText("usersMonthNew", summary.users_month_new);
      setText("searchUsersWeek", summary.searches_week_users);
      setText("searchUsersMonth", summary.searches_month_users);
      setText("membersTotal", summary.members_total);
      setText("membersWeekNew", summary.members_week_new);
      setText("membersMonthNew", summary.members_month_new);
      setText("searchCountWeek", summary.searches_week_count);
      setText("searchCountMonth", summary.searches_month_count);

      renderChart("chartNewUsers", series.days, series.new_users, series.new_members);
      renderChart("chartSearches", series.days, series.search_counts, series.search_users);
    }

    async function api(path, options = {}) {
      const res = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      return res.json();
    }

    async function loadStats() {
      try {
        const data = await api("/api/admin/stats");
        if (data?.data) {
          renderDashboard(data.data);
          return;
        }
      } catch (e) {}
      renderDashboard(fallbackData);
    }

    function renderTable(tableId, rowsHtml) {
      const table = document.getElementById(tableId);
      const tbody = table && table.querySelector("tbody");
      if (!tbody) return;
      const cols = table.querySelectorAll("thead th").length || 1;
      tbody.innerHTML = rowsHtml || '<tr><td class="muted" colspan="' + cols + '">暂无数据</td></tr>';
    }

    function formatTimestamp(ts) {
      if (!ts) return "-";
      const date = new Date(ts * 1000);
      return date.toISOString().replace("T", " ").slice(0, 19);
    }

    async function loadTemplates() {
      try {
        const data = await api("/api/admin/templates");
        const rows = (data.data || []).map(row => {
          const buttons = (() => {
            try {
              const parsed = typeof row.buttons === "string" ? JSON.parse(row.buttons) : row.buttons;
              return Array.isArray(parsed) && parsed.length ? parsed.length + " 个按钮" : "无";
            } catch {
              return "格式错误";
            }
          })();
          const status = row.is_enabled ? "启用" : "停用";
          const typeLabel = row.type === "search_reply" ? "搜图回复" : "自动回复";
          return '<tr>' +
            '<td><span class="pill">' + row.key + '</span></td>' +
            '<td>' + typeLabel + '</td>' +
            '<td>' + status + '</td>' +
            '<td>' + (row.content || "-") + '</td>' +
            '<td>' + buttons + '</td>' +
          '</tr>';
        }).join("");
        renderTable("templateTable", rows);
      } catch (e) {
        renderTable("templateTable", "");
      }
    }

    async function loadMembers() {
      try {
        const data = await api("/api/admin/members");
        const rows = (data.data || []).map(row => (
          '<tr>' +
            '<td>' + row.user_id + '</td>' +
            '<td>' + formatTimestamp(row.expires_at) + '</td>' +
            '<td>' + (row.source_group || "-") + '</td>' +
            '<td>' + (row.status || "-") + '</td>' +
            '<td>' + formatTimestamp(row.updated_at) + '</td>' +
          '</tr>'
        )).join("");
        renderTable("memberTable", rows);
      } catch (e) {
        renderTable("memberTable", "");
      }
    }

    async function loadBroadcasts() {
      try {
        const data = await api("/api/admin/broadcasts");
        const rows = (data.data || []).map(row => (
          '<tr>' +
            '<td>' + (row.content || "-") + '</td>' +
            '<td>' + formatTimestamp(row.sent_at) + '</td>' +
            '<td>' + (row.sent_count ?? 0) + '</td>' +
          '</tr>'
        )).join("");
        renderTable("broadcastTable", rows);
      } catch (e) {
        renderTable("broadcastTable", "");
      }
    }

    document.getElementById("templateForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const payload = {
        key: formData.get("key"),
        type: formData.get("type"),
        content: formData.get("content"),
        buttons: (() => {
          try {
            return JSON.parse(formData.get("buttons"));
          } catch {
            return [];
          }
        })(),
        is_enabled: formData.get("is_enabled") === "on",
      };
      const res = await api("/api/admin/templates", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        alert(res.error || "保存失败");
        return;
      }
      form.reset();
      await loadTemplates();
      setTab("templates");
    });

    document.getElementById("broadcastForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const payload = { content: formData.get("content") };
      const res = await api("/api/admin/broadcasts", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        alert(res.error || "发送失败");
        return;
      }
      form.reset();
      await loadBroadcasts();
      setTab("broadcast");
    });

    async function init() {
      await loadStats();
      await loadTemplates();
      await loadMembers();
      await loadBroadcasts();
    }
    init();
  </script>
</body>
</html>`;
}

export async function handleAdminApi(env, req, path) {
  const userId = await isAdminSession(env, req);
  if (!userId) return unauthorized();

  if (path === "/api/admin/stats" && req.method === "GET") {
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

  if (path === "/api/admin/templates" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, key, type, content, buttons, is_enabled FROM templates ORDER BY id DESC").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/api/admin/templates" && req.method === "POST") {
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

  if (path === "/api/admin/members" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT user_id, expires_at, source_group, status, updated_at FROM members ORDER BY updated_at DESC LIMIT 200").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/api/admin/broadcasts" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, content, sent_at, sent_count FROM broadcasts ORDER BY sent_at DESC LIMIT 50").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/api/admin/broadcasts" && req.method === "POST") {
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

  if (path === "/api/admin/vip-groups" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT chat_id, name FROM vip_groups ORDER BY chat_id DESC").all();
    return new Response(JSON.stringify({ ok: true, data: rows.results || [] }), { headers: JSON_HEADERS });
  }

  if (path === "/api/admin/vip-groups" && req.method === "POST") {
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
