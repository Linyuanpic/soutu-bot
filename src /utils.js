export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function getTzDateKey(tsSec, tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(tsSec * 1000));
  const map = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

export function toBase64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function buildKeyboard(buttonRows) {
  const inline_keyboard = (buttonRows || []).map(row => row.map(btn => {
    if (btn.type === "url") return { text: btn.text, url: btn.url };
    return { text: btn.text || "按钮", callback_data: btn.data || "NOOP" };
  }));
  return { inline_keyboard };
}

export function renderTemplateText(text, vars = {}) {
  let out = text || "";
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

export function renderButtonsWithVars(buttons, vars = {}) {
  if (!Array.isArray(buttons)) return [];
  return buttons.map(row => {
    if (!Array.isArray(row)) return [];
    return row.map(btn => ({
      ...btn,
      text: renderTemplateText(btn.text || "", vars),
      url: btn.url ? renderTemplateText(btn.url, vars) : btn.url,
      data: btn.data ? renderTemplateText(btn.data, vars) : btn.data,
    }));
  }).filter(row => row.length);
}

export function getMessageImageInfo(msg) {
  const photos = msg?.photo || [];
  if (photos.length) {
    const last = photos[photos.length - 1];
    if (!last?.file_id) return null;
    return { fileId: last.file_id, fileUniqueId: last.file_unique_id || "" };
  }
  const doc = msg?.document;
  if (doc?.mime_type && doc.mime_type.startsWith("image/")) {
    if (!doc.file_id) return null;
    return { fileId: doc.file_id, fileUniqueId: doc.file_unique_id || "" };
  }
  return null;
}

export function pickRandom(items) {
  if (!items?.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

export function readJsonBody(req) {
  return req.json().catch(() => null);
}
