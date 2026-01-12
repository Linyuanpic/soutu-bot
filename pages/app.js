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
}

document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    setTab(btn.dataset.tab);
  });
});

async function loadStats() {
  const data = await api("/admin/stats");
  document.getElementById("stats").textContent = JSON.stringify(data, null, 2);
}

async function loadTemplates() {
  const data = await api("/admin/templates");
  document.getElementById("templateList").textContent = JSON.stringify(data, null, 2);
}

async function loadMembers() {
  const data = await api("/admin/members");
  document.getElementById("memberList").textContent = JSON.stringify(data, null, 2);
}

async function loadBroadcasts() {
  const data = await api("/admin/broadcasts");
  document.getElementById("broadcastList").textContent = JSON.stringify(data, null, 2);
}

document.getElementById("templateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = {
    key: form.key.value.trim(),
    type: form.type.value,
    content: form.content.value,
    buttons: JSON.parse(form.buttons.value || "[]"),
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

loadStats();
loadTemplates();
loadMembers();
loadBroadcasts();
