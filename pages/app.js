const adminToken = localStorage.getItem("admin_token") || "";

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  return res.json();
}

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
    return `
      <div>
        <div class="chart-bar">
          <div class="bar primary" style="height:${aHeight}%"></div>
          <div class="bar accent" style="height:${bHeight}%"></div>
        </div>
        <div class="bar-label">${day.slice(5)}</div>
      </div>
    `;
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

async function loadStats() {
  try {
    const data = await api("/admin/stats");
    if (data?.data) {
      renderDashboard(data.data);
      return;
    }
  } catch {
    // ignore
  }
  renderDashboard(fallbackData);
}

function renderTable(tableId, rowsHtml) {
  const table = document.getElementById(tableId);
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  const cols = table?.querySelectorAll("thead th").length || 1;
  tbody.innerHTML = rowsHtml || `<tr><td class="muted" colspan="${cols}">暂无数据</td></tr>`;
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toISOString().replace("T", " ").slice(0, 19);
}

async function loadTemplates() {
  try {
    const data = await api("/admin/templates");
    const rows = (data.data || []).map(row => {
      const buttons = (() => {
        try {
          const parsed = typeof row.buttons === "string" ? JSON.parse(row.buttons) : row.buttons;
          return Array.isArray(parsed) && parsed.length ? `${parsed.length} 个按钮` : "无";
        } catch {
          return "格式错误";
        }
      })();
      const status = row.is_enabled ? "启用" : "停用";
      const typeLabel = row.type === "search_reply" ? "搜图回复" : "自动回复";
      return `
        <tr>
          <td><span class="pill">${row.key}</span></td>
          <td>${typeLabel}</td>
          <td>${status}</td>
          <td>${row.content || "-"}</td>
          <td>${buttons}</td>
        </tr>
      `;
    }).join("");
    renderTable("templateTable", rows);
  } catch {
    renderTable("templateTable", "");
  }
}

async function loadMembers() {
  try {
    const data = await api("/admin/members");
    const rows = (data.data || []).map(row => `
        <tr>
          <td>${row.user_id}</td>
          <td>${formatTimestamp(row.expires_at)}</td>
          <td>${row.source_group || "-"}</td>
          <td>${row.status || "-"}</td>
          <td>${formatTimestamp(row.updated_at)}</td>
        </tr>
      `).join("");
    renderTable("memberTable", rows);
  } catch {
    renderTable("memberTable", "");
  }
}

async function loadBroadcasts() {
  try {
    const data = await api("/admin/broadcasts");
    const rows = (data.data || []).map(row => `
        <tr>
          <td>${row.content || "-"}</td>
          <td>${formatTimestamp(row.sent_at)}</td>
          <td>${row.sent_count ?? 0}</td>
        </tr>
      `).join("");
    renderTable("broadcastTable", rows);
  } catch {
    renderTable("broadcastTable", "");
  }
}

document.getElementById("templateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  let buttons = [];
  try {
    buttons = JSON.parse(form.buttons.value || "[]");
  } catch {
    buttons = [];
  }
  const payload = {
    key: form.key.value.trim(),
    type: form.type.value,
    content: form.content.value,
    buttons,
    is_enabled: form.is_enabled.checked,
  };
  await api("/admin/templates", { method: "POST", body: JSON.stringify(payload) });
  await loadTemplates();
});

document.getElementById("broadcastForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = { content: form.content.value };
  await api("/admin/broadcasts", { method: "POST", body: JSON.stringify(payload) });
  form.reset();
  await loadBroadcasts();
});

renderDashboard(fallbackData);
loadStats();
loadTemplates();
loadMembers();
loadBroadcasts();
