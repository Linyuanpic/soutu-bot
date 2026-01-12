import {
  IMAGE_REPLY_DEFAULT_BUTTONS,
  IMAGE_REPLY_DEFAULT_TEXT,
  IMAGE_REPLY_TEMPLATE_KEY,
  TEMPLATE_SORT_ORDER,
  JSON_HEADERS,
  GROUP_MEMBER_EXPIRE_DAYS,
} from "./config.js";
import { ensureUser, getDb, getTemplate, upsertManagedChat } from "./db.js";
import { getKv } from "./kv.js";
import {
  buildImageSearchLinks,
  buildSignedProxyUrl,
  getDailySearchStatus,
  recordDailyImageStats,
  recordDailySearchCount,
  getTelegramFilePath,
  shouldNotifyMediaGroup,
  shouldNotifyVideoWarning,
} from "./image.js";
import { ensureMembershipThrough, isMember } from "./auth.js";
import { ensureBotCommands, tgCall, trySendMessage } from "./telegram.js";
import {
  appendFixedStartButtons,
  buildKeyboard,
  buildUserDisplay,
  buildUserStatusLabel,
  fmtDateTime,
  getMessageImageInfo,
  getTzParts,
  getTzDateKey,
  getTzDayStart,
  getTzWeekStart,
  getBotUserId,
  isPrivateChat,
  isVideoMessage,
  normalizeTelegramHtml,
  nowSec,
  parseAdminIds,
  renderButtonsWithVars,
  renderTemplateText,
} from "./utils.js";
const SEARCH_MEDIA_GROUP_BUFFER_MS = 500;
const searchMediaGroupBuffers = new Map();

async function sendStartTemplate(env, userId) {
  await ensureBotCommands(env);
  const tpl = await getTemplate(env, "start");
  if (!tpl) throw new Error("Missing template: start");
  const buttons = appendFixedStartButtons(tpl.buttons);
  await trySendMessage(env, userId, {
    chat_id: userId,
    text: normalizeTelegramHtml(tpl.text),
    parse_mode: tpl.parse_mode,
    disable_web_page_preview: tpl.disable_preview,
    reply_markup: buildKeyboard(buttons),
  });
}

async function markGroupUserAsMember(env, user) {
  const userId = user?.id;
  if (!Number.isFinite(userId)) return;
  await ensureUser(env, user);
  const expireAt = nowSec() + GROUP_MEMBER_EXPIRE_DAYS * 86400;
  await ensureMembershipThrough(env, userId, expireAt);
}

async function handleImageOrVideoMessage(env, msg, requestUrlString) {
  const userId = msg.from?.id;
  if (!Number.isFinite(userId)) return false;
  if (isVideoMessage(msg)) {
    const warned = await shouldNotifyVideoWarning(env, userId);
    if (warned || await shouldNotifyCooldown(env, `video_warn_cd:${userId}`, 600)) {
      await tgCall(env, "sendMessage", { chat_id: userId, text: "本机器人只支持图片搜索哦～" });
    }
    return true;
  }

  const imageInfo = getMessageImageInfo(msg);
  if (!imageInfo) return false;
  const member = await isMember(env, userId);
  const searchStatus = await getDailySearchStatus(env, userId, member);
  if (!searchStatus.allowed) {
    if (member) {
      await tgCall(env, "sendMessage", { chat_id: userId, text: "服务器异常，请稍后再尝试搜索。" });
    } else {
      await sendStartTemplate(env, userId);
    }
    return true;
  }
  try {
    await getTelegramFilePath(env, imageInfo.fileId, imageInfo.fileUniqueId);
    const imageUrl = await buildSignedProxyUrl(env, requestUrlString, imageInfo.fileId, userId);
    const links = buildImageSearchLinks(imageUrl);
    const tpl = await getTemplate(env, IMAGE_REPLY_TEMPLATE_KEY);
    const replyText = normalizeTelegramHtml(renderTemplateText(tpl?.text || IMAGE_REPLY_DEFAULT_TEXT, {
      image_url: imageUrl,
      google_lens: links.google,
      yandex: links.yandex
    }));
    const replyButtons = renderButtonsWithVars(tpl?.buttons?.length ? tpl.buttons : IMAGE_REPLY_DEFAULT_BUTTONS, {
      image_url: imageUrl,
      google_lens: links.google,
      yandex: links.yandex
    });
    await trySendMessage(env, userId, {
      chat_id: userId,
      text: replyText,
      parse_mode: tpl?.parse_mode || "HTML",
      disable_web_page_preview: tpl ? tpl.disable_preview : true,
      reply_markup: replyButtons.length ? buildKeyboard(replyButtons) : undefined,
      reply_to_message_id: msg.message_id
    });
    await recordDailyImageStats(env, userId);
    await recordDailySearchCount(env, userId);
  } catch (e) {
    await tgCall(env, "sendMessage", { chat_id: userId, text: "图片处理失败，请稍后再试。" });
  }
  return true;
}

function bufferSearchMediaGroup(env, msg, requestUrlString) {
  const groupId = msg.media_group_id;
  if (!groupId) return Promise.resolve(false);
  let entry = searchMediaGroupBuffers.get(groupId);
  if (!entry) {
    entry = { messages: [], timer: null, promise: null, resolve: null, userId: msg.from?.id };
    entry.promise = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    searchMediaGroupBuffers.set(groupId, entry);
  }
  if (!entry.userId) entry.userId = msg.from?.id;
  entry.messages.push(msg);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    const currentEntry = searchMediaGroupBuffers.get(groupId);
    if (!currentEntry) return;
    searchMediaGroupBuffers.delete(groupId);
    const messages = currentEntry.messages.slice().sort((a, b) => (a.message_id || 0) - (b.message_id || 0));
    if (messages.length === 1) {
      const handled = await handleImageOrVideoMessage(env, messages[0], requestUrlString);
      currentEntry.resolve?.(handled);
      return;
    }
    const userId = currentEntry.userId;
    if (Number.isFinite(userId) && (await shouldNotifyMediaGroup(env, userId, groupId)
      || await shouldNotifyCooldown(env, `media_group_cd:${userId}`, 600))) {
      await tgCall(env, "sendMessage", { chat_id: userId, text: "请发送一张图片进行搜索哦～" });
    }
    currentEntry.resolve?.(true);
  }, SEARCH_MEDIA_GROUP_BUFFER_MS);
  return entry.promise;
}

async function shouldNotifyCooldown(env, key, ttlSec) {
  const kv = getKv(env);
  if (!kv) return true;
  const notified = await kv.get(key);
  if (notified) return false;
  await kv.put(key, "1", { expirationTtl: ttlSec });
  return true;
}

async function handleBotAddedToChat(env, chat, inviterId) {
  const adminIds = parseAdminIds(env);
  const chatId = chat?.id;
  if (!Number.isFinite(chatId)) return;
  if (!adminIds.includes(inviterId)) {
    await tgCall(env, "leaveChat", { chat_id: chatId });
    return;
  }
  await upsertManagedChat(env, chat);
}

async function handleGroupMessage(env, msg) {
  const chatType = msg?.chat?.type;
  if (!["group", "supergroup", "channel"].includes(chatType)) return false;
  const botId = getBotUserId(env);
  if (botId && Array.isArray(msg?.new_chat_members)) {
    const addedBot = msg.new_chat_members.some(member => member?.id === botId);
    if (addedBot) {
      await handleBotAddedToChat(env, msg.chat, msg.from?.id);
      return true;
    }
  }
  if (Array.isArray(msg?.new_chat_members)) {
    for (const member of msg.new_chat_members) {
      if (member?.id && member.id !== botId) {
        await markGroupUserAsMember(env, member);
      }
    }
  }
  if (msg.from?.id && msg.from.id !== botId) {
    await markGroupUserAsMember(env, msg.from);
  }
  return true;
}

async function handleBotChatMemberUpdate(env, payload) {
  const botId = getBotUserId(env);
  if (!botId) return false;
  const chat = payload?.chat;
  const newMember = payload?.new_chat_member;
  if (newMember?.user?.id !== botId) return false;
  const status = newMember?.status || "";
  if (!["member", "administrator"].includes(status)) return false;
  await handleBotAddedToChat(env, chat, payload?.from?.id);
  return true;
}
/** Admin login: /login in bot DM generates a one-time link */
export async function handleAdminLoginCommand(env, msg, origin) {
  const adminIds = parseAdminIds(env);
  const fromId = msg.from?.id;
  if (!adminIds.includes(fromId)) {
    // silently ignore or tell no permission
    return;
  }
  const token = crypto.randomUUID().replaceAll("-", "");
  await getKv(env).put(`admin_login_token:${token}`, String(fromId), { expirationTtl: 600 });
  const loginUrl = `${origin}/admin?token=${encodeURIComponent(token)}`;
  await tgCall(env, "sendMessage", {
    chat_id: fromId,
    text: `后台登录链接（10分钟内有效）：\n<a href="${loginUrl}">${loginUrl}</a>\n打开后将自动登录后台。该链接仅可使用一次。`,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

export async function isAdminSession(env, req) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/admin_session=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const token = m[1];
  const v = await getKv(env).get(`admin_session:${token}`);
  if (!v) return null;
  return Number(v);
}
export function adminHtml() {
  // IMPORTANT: Do not use nested JS template literals inside this HTML, or it will break the Worker source.
  // This version avoids backticks in the embedded <script>.
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>机器人后台</title>
  <style>
    body{margin:0;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#eef2f7;color:#0f172a}
    .wrap{display:flex;min-height:100vh;padding:16px;gap:16px;box-sizing:border-box}
    .side{width:150px;background:#fff;border:1px solid #dbe2ea;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:14px;box-shadow:0 1px 2px rgba(15,23,42,0.06)}
    .side-header{display:flex;flex-direction:column;gap:4px}
    .side-title{font-size:18px;font-weight:700;color:#0f172a}
    .side-sub{color:#94a3b8;font-size:12px;text-align:center;width:100%}
    .side-nav{display:flex;flex-direction:column;gap:6px}
    .side a{display:flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:10px;color:#1f2937;text-decoration:none;font-weight:500;text-align:center}
    .side a.active{background:#e7f2ff;color:#1378d1;font-weight:600}
    .main{flex:1;padding:24px;overflow:auto;background:#fff;border:1px solid #dbe2ea;border-radius:18px;box-shadow:0 1px 2px rgba(15,23,42,0.06)}
    .card{background:#fff;border:1px solid #dbe2ea;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
    .row{display:flex;gap:12px;flex-wrap:wrap}
    .row-end{justify-content:flex-end}
    .row-between{justify-content:space-between;align-items:center}
    input,textarea,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:12px;box-sizing:border-box;background:#fff;color:#0f172a}
    select{text-align:center;text-align-last:center}
    select option{text-align:center}
    textarea{min-height:140px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace}
    button{height:38px;padding:0 14px;border:0;border-radius:12px;background:#2aabee;color:#fff;cursor:pointer;font-weight:600}
    button.gray{background:#64748b}
    button.red{background:#ef4444}
    .btn-link{display:inline-flex;align-items:center;justify-content:center;padding:0 16px;border-radius:12px;background:#e2e8f0;color:#111;text-decoration:none;height:38px}
    .action-btn{height:36px;min-width:96px;padding:0 12px;border-radius:10px}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #e5e7eb;padding:12px;text-align:left;font-size:14px}
    .muted{color:#6b7280;font-size:12px}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f2ff;color:#0b70c8;font-size:12px}
    .hidden{display:none}
    hr{border:0;border-top:1px solid #e5e7eb;margin:14px 0}
    .btn-grid{display:flex;flex-direction:column;gap:10px;flex:1}
    .btn-row{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
    .btn-row-head{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px}
    .btn-item{display:grid;grid-template-columns:1fr 90px 1.4fr 40px;gap:8px;align-items:center;margin-bottom:8px}
    .btn-item select{width:100%}
    .center{text-align:center}
    .cell-actions{white-space:nowrap}
    .toolbar{display:flex;gap:8px;flex-wrap:wrap}
    .toolbar button{padding:0 12px;border-radius:10px;background:#e2e8f0;color:#111;height:36px;font-weight:600;font-size:13px}
    .template-panels{display:flex;gap:14px;align-items:stretch}
    .template-panel{flex:1;min-width:320px;display:flex;flex-direction:column}
    .template-panel .panel-body{flex:1;display:flex;flex-direction:column}
    .template-textarea{flex:1;min-height:320px;resize:vertical}
    .template-editor{flex:1;min-height:320px;resize:vertical;padding:10px;border:1px solid #d1d5db;border-radius:10px;box-sizing:border-box;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;background:#fff;white-space:pre-wrap}
    .template-editor:empty:before{content:attr(data-placeholder);color:#9ca3af}
    .template-editor:focus{outline:none;border-color:#93c5fd;box-shadow:0 0 0 2px rgba(59,130,246,0.2)}
    .btn-row-head{margin-bottom:8px}
    .centered-table th,.centered-table td{text-align:center}
    .dash-grid{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px}
    .dash-card{display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100px;gap:6px}
    .dash-card .pill{margin:0 0 8px}
    .dash-card .dash-value{margin-top:10px}
    .dash-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px;margin-top:14px}
    .dash-chart-card{display:flex;flex-direction:column;gap:8px}
    .dash-chart-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .dash-chart-head h4{margin:0;font-size:14px}
    .dash-legend{display:flex;gap:12px;font-size:12px;color:#64748b;align-items:center}
    .dash-legend span{display:flex;align-items:center;gap:6px}
    .dash-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;background:#2aabee}
    .dash-legend i.legend-secondary{background:#94a3b8}
    .dash-chart{width:100%;height:220px}
    .dash-chart svg{width:100%;height:100%}
    .tpl-toolbar{padding-right:0}
    .tpl-toolbar .row-end{margin-right:-4px}
    .tpl-toolbar-actions{display:grid;grid-template-columns:120px 120px;gap:10px;align-items:end;margin-left:auto}
    .tpl-toolbar-actions button{width:100%}
    .table-edge th:first-child,.table-edge td:first-child{padding-left:12px}
    .table-edge th:last-child,.table-edge td:last-child{padding-right:12px}
    .table-edge td:last-child{text-align:right}
    .table-edge th.col-actions,.table-edge td.col-actions{text-align:right;padding-right:16px;width:140px}
    .compact-table th,.compact-table td{padding:6px 8px}
    .center-2-4 th:nth-child(2),.center-2-4 td:nth-child(2),
    .center-2-4 th:nth-child(3),.center-2-4 td:nth-child(3),
    .center-2-4 th:nth-child(4),.center-2-4 td:nth-child(4){text-align:center}
    .auto-rule-edit{display:grid;grid-template-columns:110px 110px 100px 140px minmax(140px,1fr) 100px 120px;gap:12px;align-items:end}
    .auto-rule-field{display:flex;flex-direction:column;min-width:0}
    .auto-rule-field label{font-size:12px;color:#6b7280;margin-bottom:4px;text-align:center}
    .auto-rule-edit input,.auto-rule-edit select{height:40px;text-align:center;width:100%}
    .auto-rule-edit select{text-align-last:center}
    .auto-rule-edit input[data-field="template_title"]{max-width:220px}
    .auto-rule-actions{display:flex;gap:8px;align-items:flex-end;justify-content:flex-end;padding-bottom:2px}
    .auto-rule-actions button{min-width:84px}
    .bc-row{align-items:flex-end}
    .bc-row .field-audience{width:220px}
    .bc-row .field-key{flex:0.65;min-width:180px}
    .bc-row .field-title{flex:0.9;min-width:220px}
    .bc-row .field-actions{margin-left:auto}
    .bc-row .field-actions button{width:160px}
    .bc-jobs-table{table-layout:fixed}
    .bc-jobs-table th,.bc-jobs-table td{text-align:center}
    .bc-jobs-table th:first-child,.bc-jobs-table td:first-child{text-align:left;width:32%}
    .bc-jobs-table th:last-child,.bc-jobs-table td:last-child{text-align:right}
    .gen-grid{display:grid;grid-template-columns:120px 120px 120px minmax(220px,1fr);gap:12px;align-items:end}
    .gen-grid .field{display:flex;flex-direction:column;min-width:0}
    .gen-grid .field label{font-size:12px;color:#6b7280;margin-bottom:6px;text-align:center;min-height:16px}
    .gen-grid input,.gen-grid select{height:40px;text-align:center}
    .gen-grid .action-group{display:flex;gap:10px;justify-content:flex-end;align-items:flex-end;padding-top:6px}
    .gen-grid .action-group button{min-width:120px}
    .code-toolbar-grid{display:grid;grid-template-columns:minmax(240px,1fr) 140px 140px;gap:12px;align-items:end}
    .code-toolbar-grid .code-toolbar-search{grid-column:1/2}
    .code-toolbar-grid button{width:140px}
    .code-table th.col-user,.code-table td.col-user,
    .code-table th.col-used,.code-table td.col-used{text-align:center;width:140px}
    .code-table th.col-actions,.code-table td.col-actions{text-align:right;width:120px}
    .tpl-table th:nth-child(3),.tpl-table td:nth-child(3){text-align:center;white-space:nowrap;width:90px}
    .tpl-table th.col-updated,.tpl-table td.col-updated{text-align:center;width:160px}
    .tpl-table th.col-actions,.tpl-table td.col-actions{text-align:right;width:120px}
    .auto-rule-table th.col-actions,.auto-rule-table td.col-actions{text-align:center;width:120px}
    .chat-edit-grid{display:grid;grid-template-columns:minmax(160px,220px) 160px minmax(220px,1.4fr) 140px auto;gap:12px;align-items:end}
    .chat-edit-grid .field{display:flex;flex-direction:column;min-width:0}
    .chat-edit-grid .field label{font-size:12px;color:#6b7280;margin-bottom:4px;text-align:center}
    .chat-edit-grid input,.chat-edit-grid select{text-align:center;height:40px}
    .chat-edit-actions{display:flex;gap:10px;align-items:flex-end}
    .chat-edit-actions button{height:36px}
    .code-output{font-size:15px;line-height:1.5}
    .pagination{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px}
    .pagination button{background:#e2e8f0;color:#111;padding:6px 12px;border-radius:10px;height:auto}
    .pagination button.active{background:#2aabee;color:#fff}
    .copy-code{display:inline-block;padding:2px 8px;border-radius:6px;background:#f3f4f6;color:#111827;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;cursor:pointer}
    .copy-code:hover{background:#e5e7eb}
    .compact-table th.col-actions,.compact-table td.col-actions{text-align:right}
  </style>
</head>
<body>
  <div class="wrap">
    <aside class="side">
      <div class="side-header">
        <div class="side-title">机器人后台</div>
        <div class="side-sub" id="who"></div>
      </div>
      <nav class="side-nav">
        <a href="#dashboard" id="nav-dashboard">数据看板</a>
        <a href="#templates" id="nav-templates">回复模版</a>
        <a href="#broadcast" id="nav-broadcast">广播中心</a>
        <a href="#members" id="nav-members">会员管理</a>
        <a href="#users" id="nav-users">用户管理</a>
      </nav>
    </aside>

    <div class="main">
      <div class="card" id="view-login">
        <h3>管理员登录</h3>
        <p class="muted">使用已绑定的管理员账号向机器人发送 <span class="copy-code" id="loginCommand">/login</span> 获取一次性登录链接，点击链接即可进入后台。</p>
        <div class="row">
          <div style="flex:1;min-width:220px">
            <label>登录码</label>
            <input id="loginCodeInput" placeholder="请通过 /login 获取登录链接" disabled />
          </div>
          <div style="width:140px;display:flex;align-items:flex-end">
            <button id="loginSubmit" disabled>登录</button>
          </div>
        </div>
        <p class="muted" id="loginMsg"></p>
      </div>

      <div class="card hidden" id="view-dashboard">
        <div id="dash"></div>
        <div class="dash-chart-grid">
          <div class="card dash-chart-card">
            <div class="dash-chart-head">
              <h4>近一周关注机器人用户</h4>
            </div>
            <div id="dashFollowChart" class="dash-chart"></div>
          </div>
          <div class="card dash-chart-card">
            <div class="dash-chart-head">
              <h4>近一周发图数量与人数</h4>
              <div class="dash-legend">
                <span><i></i>数量</span>
                <span><i class="legend-secondary"></i>人数</span>
              </div>
            </div>
            <div id="dashImageChart" class="dash-chart"></div>
          </div>
        </div>
      </div>

      <div class="card hidden" id="view-templates">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">回复模版</h3>
        </div>
        <div class="row row-between tpl-toolbar">
          <div style="flex:1;min-width:220px">
            <input id="tplSearch" placeholder="搜索 标题 / 文本关键字" />
          </div>
          <div class="tpl-toolbar-actions">
            <button class="gray action-btn" id="tplRefresh">刷新</button>
            <button class="action-btn" id="newTplBtn">新增模版</button>
          </div>
        </div>
        <div id="tplTable"></div>
      </div>

      <div class="card hidden" id="view-template-editor">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 id="tplEditorTitle" style="margin:0">模板编辑</h3>
          <button class="gray" id="tplBack">返回列表</button>
        </div>
        <div class="row" style="margin-top:12px">
          <div style="flex:1;min-width:220px">
            <label>Key（唯一）</label>
            <input id="tplKey" />
          </div>
          <div style="flex:2;min-width:220px">
            <label>标题（中文）</label>
            <input id="tplTitle" />
          </div>
          <div style="width:180px">
            <label>是否关闭链接预览</label>
            <select id="tplDisablePreview">
              <option value="0">显示预览</option>
              <option value="1">关闭预览</option>
            </select>
          </div>
        </div>

        <div class="template-panels" style="margin-top:10px">
          <div class="template-panel">
            <div class="row row-between" style="align-items:center">
              <label style="margin:0">文本编辑</label>
              <div class="toolbar">
                <button type="button" data-format="bold">粗体</button>
                <button type="button" data-format="italic">斜体</button>
                <button type="button" data-format="underline">下划线</button>
                <button type="button" data-format="strike">删除线</button>
                <button type="button" data-format="link">链接</button>
              </div>
            </div>
            <div class="panel-body" style="margin-top:8px">
              <div id="tplTextEditor" class="template-editor" contenteditable="true" data-placeholder="请输入模板内容"></div>
            </div>
          </div>
          <div class="template-panel">
            <div class="row row-between" style="align-items:center">
              <label style="margin:0">按钮设置</label>
              <button class="gray action-btn" id="tplAddRow">+ 添加按钮行</button>
            </div>
            <div class="panel-body" style="margin-top:8px">
              <div id="tplButtonsEditor" class="btn-grid"></div>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:12px">
          <button id="tplSave">保存</button>
          <button class="gray" id="tplPreviewBtn">发送预览</button>
          <button class="gray" id="tplCancel">取消</button>
          <button class="red" id="tplDelete">删除</button>
        </div>
        <p class="muted" id="tplMsg"></p>
      </div>

      <div class="card hidden" id="view-broadcast">
        <h3>广播中心</h3>
        <div class="row bc-row">
          <div class="field-audience">
            <label>人群</label>
            <select id="bcAudience">
              <option value="all">全部用户</option>
              <option value="member">会员用户</option>
              <option value="nonmember">非会员用户</option>
            </select>
          </div>
          <div class="field-key">
            <label>模板Key</label>
            <input id="bcTplKey" placeholder="例如 exp_before_30d" />
          </div>
          <div class="field-title">
            <label>标题</label>
            <input id="bcTplTitle" placeholder="自动显示" disabled />
          </div>
          <div class="field-actions">
            <button id="bcCreate">创建并开始</button>
          </div>
        </div>
        <p class="muted">提示：广播会分批发送，避免触发限制。可在下方查看任务状态。</p>
        <div id="bcJobs"></div>
      </div>

      <div class="card hidden" id="view-members">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">会员管理</h3>
        </div>
        <div class="row row-between">
          <div style="flex:1;min-width:220px">
            <input id="memberSearch" placeholder="搜索用户昵称 / 用户ID" />
          </div>
        </div>
        <div id="memberTable"></div>
        <div id="memberPagination" class="pagination"></div>
      </div>

      <div class="card hidden" id="view-users">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">用户管理</h3>
        </div>
        <div class="row row-between">
          <div style="flex:1;min-width:220px">
            <input id="userSearch" placeholder="搜索用户昵称 / 用户ID" />
          </div>
        </div>
        <div id="userTable"></div>
        <div id="userPagination" class="pagination"></div>
      </div>
    </div>
  </div>

<script>
  function $(id){ return document.getElementById(id); }
  var views = ["login","dashboard","templates","template-editor","broadcast","members","users"];
  var IMAGE_REPLY_TEMPLATE_KEY = ${JSON.stringify(IMAGE_REPLY_TEMPLATE_KEY)};
  var IMAGE_REPLY_DEFAULT_TEXT = ${JSON.stringify(IMAGE_REPLY_DEFAULT_TEXT)};
  var IMAGE_REPLY_DEFAULT_BUTTONS = ${JSON.stringify(IMAGE_REPLY_DEFAULT_BUTTONS)};

  function showView(name){
    for (var i=0;i<views.length;i++){
      var v = views[i];
      $("view-"+v).classList.toggle("hidden", v!==name);
      var nav = $("nav-"+v);
      if(nav) nav.classList.toggle("active", v===name);
    }
    if(name==="dashboard") { loadDashboard(); }
    if(name==="templates") loadTemplates();
    if(name==="template-editor") loadTemplateEditorFromUrl();
    if(name==="broadcast") { loadBroadcastJobs(); loadTemplateTitles().then(function(){ updateTemplateTitleDisplay($("bcTplKey").value.trim(), "bcTplTitle"); }); }
    if(name==="members") loadMembers();
    if(name==="users") loadUsers();
    if(name==="login") { startLogin(); }
  }

  window.addEventListener("hashchange", function(){
    var h = location.hash.replace("#","") || "login";
    showView(h);
  });

  async function api(path, opts){
    opts = opts || {};
    var res = await fetch(path, Object.assign({ credentials:"include" }, opts));
    var txt = await res.text();
    var data;
    try{ data = JSON.parse(txt); }catch(e){ data = { ok:false, error:"Bad JSON", raw:txt }; }
    if(!res.ok) throw new Error(data.error || txt);
    return data;
  }

  async function whoami(){
    try{
      var d = await api("/api/admin/whoami");
      $("who").textContent = d.user_id ? ("UID: " + d.user_id) : "";
      return d.user_id;
    }catch(e){
      $("who").textContent = "";
      return null;
    }
  }

  async function startLogin(){
    $("loginMsg").textContent = "";
    $("loginCodeInput").value = "";
  }

  async function submitLogin(){
    var code = $("loginCodeInput").value.trim();
    if (!code) {
      $("loginMsg").textContent = "请输入登录码。";
      return;
    }
    try{
      await api("/api/admin/login", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ code: code }) });
      $("loginMsg").textContent = "登录成功";
      location.hash = "#dashboard";
      await whoami();
    }catch(e){
      $("loginMsg").textContent = "登录失败：" + e.message;
    }
  }

  $("loginCommand").onclick = async function(){
    try{
      await navigator.clipboard.writeText("/login");
      $("loginMsg").textContent = "命令已复制，请发送给机器人。";
    }catch(e){
      $("loginMsg").textContent = "复制失败，请手动选择复制。";
    }
  };
  $("loginSubmit").onclick = submitLogin;
  $("loginCodeInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") submitLogin();
  });

  var topLoginBtn = $("topLoginBtn");
  if (topLoginBtn) {
    topLoginBtn.onclick = function(){
      location.hash = "#login";
    };
  }

  var logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = async function(){
      try{ await api("/api/admin/logout", { method:"POST" }); }catch(e){}
      location.hash = "#login";
      await whoami();
    };
  }

  // Dashboard
  function renderBarChart(containerId, series, color){
    var container = $(containerId);
    if (!container) return;
    if (!series || !series.length) {
      container.innerHTML = '<div class="muted">暂无数据</div>';
      return;
    }
    var max = 0;
    for (var i=0;i<series.length;i++){
      if (series[i].count > max) max = series[i].count;
    }
    if (max === 0) max = 1;
    var width = 1000;
    var height = 220;
    var padding = 28;
    var slot = (width - padding * 2) / series.length;
    var barWidth = slot * 0.6;
    var html = '';
    html += '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">';
    html += '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="#e2e8f0" stroke-width="2" />';
    for (var j=0;j<series.length;j++){
      var x = padding + slot * j + (slot - barWidth) / 2;
      var barHeight = (height - padding * 2) * (series[j].count / max);
      var y = height - padding - barHeight;
      html += '<rect x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + barHeight + '" fill="' + (color || "#2aabee") + '" rx="3" />';
      html += '<text x="' + (x + barWidth / 2) + '" y="' + (height - 8) + '" fill="#94a3b8" font-size="12" text-anchor="middle">' + (series[j].date || "") + '</text>';
    }
    html += '<text x="' + padding + '" y="16" fill="#94a3b8" font-size="12">最高 ' + max + '</text>';
    html += '</svg>';
    container.innerHTML = html;
  }

  function renderDoubleBarChart(containerId, series){
    var container = $(containerId);
    if (!container) return;
    if (!series || !series.length) {
      container.innerHTML = '<div class="muted">暂无数据</div>';
      return;
    }
    var max = 0;
    for (var i=0;i<series.length;i++){
      if (series[i].count > max) max = series[i].count;
      if (series[i].users > max) max = series[i].users;
    }
    if (max === 0) max = 1;
    var width = 1000;
    var height = 220;
    var padding = 28;
    var slot = (width - padding * 2) / series.length;
    var barWidth = slot * 0.32;
    var gap = slot * 0.1;
    var html = '';
    html += '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">';
    html += '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="#e2e8f0" stroke-width="2" />';
    for (var j=0;j<series.length;j++){
      var baseX = padding + slot * j + (slot - (barWidth * 2 + gap)) / 2;
      var barHeightA = (height - padding * 2) * (series[j].count / max);
      var barHeightB = (height - padding * 2) * (series[j].users / max);
      var yA = height - padding - barHeightA;
      var yB = height - padding - barHeightB;
      html += '<rect x="' + baseX + '" y="' + yA + '" width="' + barWidth + '" height="' + barHeightA + '" fill="#2aabee" rx="3" />';
      html += '<rect x="' + (baseX + barWidth + gap) + '" y="' + yB + '" width="' + barWidth + '" height="' + barHeightB + '" fill="#94a3b8" rx="3" />';
      html += '<text x="' + (padding + slot * j + slot / 2) + '" y="' + (height - 8) + '" fill="#94a3b8" font-size="12" text-anchor="middle">' + (series[j].date || "") + '</text>';
    }
    html += '<text x="' + padding + '" y="16" fill="#94a3b8" font-size="12">最高 ' + max + '</text>';
    html += '</svg>';
    container.innerHTML = html;
  }

  async function loadDashboard(){
    try{
      var d = await api("/api/admin/dashboard");
      var html = "";
      html += '<div class="dash-grid">';
      html += '<div class="card dash-card" data-target="users" style="cursor:pointer"><div class="pill">全部用户</div><h2 class="dash-value">' + d.total_users + '</h2></div>';
      html += '<div class="card dash-card" data-target="members" style="cursor:pointer"><div class="pill">会员用户</div><h2 class="dash-value">' + d.members + '</h2></div>';
      html += '<div class="card dash-card" data-target="members" style="cursor:pointer"><div class="pill">即将到期</div><h2 class="dash-value">' + d.expiring_7d + '</h2></div>';
      html += '<div class="card dash-card" data-target="members" style="cursor:pointer"><div class="pill">过期会员</div><h2 class="dash-value">' + d.expired + '</h2></div>';
      html += '<div class="card dash-card"><div class="pill">本周关注</div><h2 class="dash-value">' + d.week_follow + '</h2></div>';
      html += '<div class="card dash-card"><div class="pill">本月关注</div><h2 class="dash-value">' + d.month_follow + '</h2></div>';
      html += '<div class="card dash-card"><div class="pill">本周搜图</div><h2 class="dash-value">' + d.week_images + '</h2></div>';
      html += '<div class="card dash-card"><div class="pill">本月搜图</div><h2 class="dash-value">' + d.month_images + '</h2></div>';
      html += '</div>';
      $("dash").innerHTML = html;
      renderBarChart("dashFollowChart", d.weekly_follow_series || []);
      renderDoubleBarChart("dashImageChart", d.weekly_image_series || []);
      var codes = $("dash").querySelectorAll("[data-target]");
      for (var i=0;i<codes.length;i++){
        codes[i].onclick = function(){
          var target = this.getAttribute("data-target");
          if (target) location.hash = "#" + target;
        };
      }
    }catch(e){
      $("dash").textContent = "请先登录。";
      var followChart = $("dashFollowChart");
      if (followChart) followChart.innerHTML = "";
      var imageChart = $("dashImageChart");
      if (imageChart) imageChart.innerHTML = "";
    }
  }

  // Templates
  var tplList = [];
  var tplButtonsData = [];
  function normalizeEditorHtml(html){
    return String(html || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/<div><br><\\\/div>/gi, "<br>")
      .replace(/<div>/gi, "")
      .replace(/<\\\/div>/gi, "<br>")
      .replace(/<p><br><\\\/p>/gi, "<br>")
      .replace(/<p>/gi, "")
      .replace(/<\\\/p>/gi, "<br>");
  }
  function getTplEditorHtml(){
    var editor = $("tplTextEditor");
    if (!editor) return "";
    return normalizeEditorHtml(editor.innerHTML || "");
  }
  function setTplEditorHtml(html){
    var editor = $("tplTextEditor");
    if (!editor) return;
    var value = String(html || "").replace(/\\n/g, "<br>");
    editor.innerHTML = value;
  }
  function escapeHtml(s){
    return (s||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }
  function renderPagination(containerId, current, totalPages, onPageChange){
    var container = $(containerId);
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ""; return; }
    var html = "";
    var prev = Math.max(1, current - 1);
    var next = Math.min(totalPages, current + 1);
    html += '<button data-page="' + prev + '"' + (current === 1 ? ' disabled' : '') + '>&lt;</button>';

    var windowStart = Math.max(1, Math.min(current - 2, totalPages - 4));
    var windowEnd = Math.min(totalPages, windowStart + 4);

    if (windowStart > 1) {
      html += '<button data-page="1">1</button>';
      if (windowStart > 2) {
        var jumpBack = Math.max(1, current - 5);
        html += '<button data-page="' + jumpBack + '">···</button>';
      }
    }

    for (var p=windowStart;p<=windowEnd;p++){
      html += '<button data-page="' + p + '"' + (p === current ? ' class="active"' : '') + '>' + p + '</button>';
    }

    if (windowEnd < totalPages) {
      if (windowEnd < totalPages - 1) {
        var jumpForward = Math.min(totalPages, current + 5);
        html += '<button data-page="' + jumpForward + '">···</button>';
      }
      html += '<button data-page="' + totalPages + '">' + totalPages + '</button>';
    }

    html += '<button data-page="' + next + '"' + (current === totalPages ? ' disabled' : '') + '>&gt;</button>';
    container.innerHTML = html;
    var btns = container.querySelectorAll("button[data-page]");
    for (var i=0;i<btns.length;i++){
      btns[i].onclick = function(){
        var page = Number(this.getAttribute("data-page"));
        if (page && page !== current) onPageChange(page);
      };
    }
  }
  function renderTplTable(list){
    var rows = "";
    for (var i=0;i<list.length;i++){
      var t = list[i];
      rows += '<tr>';
      rows += '<td><b>' + escapeHtml(t.title || "未命名模板") + '</b></td>';
      rows += '<td>' + escapeHtml((t.text||"").slice(0,60)) + '</td>';
      rows += '<td>' + t.btn_rows + ' 行</td>';
      rows += '<td class="col-updated">' + escapeHtml(t.updated_at) + '</td>';
      rows += '<td>' + (t.is_system ? '<span class="pill">系统</span>' : '') + '</td>';
      rows += '<td class="col-actions"><button class="gray action-btn" data-k="' + escapeHtml(t.key) + '">编辑</button></td>';
      rows += '</tr>';
    }
    $("tplTable").innerHTML = '<table class="table-edge tpl-table"><thead><tr><th>标题</th><th>内容预览</th><th>按钮</th><th class="col-updated">更新时间</th><th></th><th class="col-actions">操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
    var btns = $("tplTable").querySelectorAll("button[data-k]");
    for (var j=0;j<btns.length;j++){
      btns[j].onclick = function(){
        var k = this.getAttribute("data-k");
        location.href = "/admin?view=template&key=" + encodeURIComponent(k);
      };
    }
  }

  async function loadTemplates(){
    try{
      var d = await api("/api/admin/templates");
      tplList = d.items || [];
      renderTplTable(tplList);
    }catch(e){
      $("tplTable").textContent = "请先登录。";
    }
  }

  $("tplRefresh").onclick = loadTemplates;
  $("tplSearch").oninput = function(){
    var q = $("tplSearch").value.trim().toLowerCase();
    if(!q) return renderTplTable(tplList);
    var f = [];
    for (var i=0;i<tplList.length;i++){
      var t = tplList[i];
      var s = (t.key||"").toLowerCase() + " " + (t.title||"").toLowerCase() + " " + (t.text||"").toLowerCase();
      if (s.indexOf(q) >= 0) f.push(t);
    }
    renderTplTable(f);
  };

  function normalizeButtonsData(buttons){
    if (!Array.isArray(buttons)) return [];
    return buttons.map(function(row){
      if (!Array.isArray(row)) return [];
      return row.map(function(btn){
        return {
          text: btn.text || "",
          type: btn.type === "callback" ? "callback" : "url",
          url: btn.url || "",
          data: btn.data || ""
        };
      });
    });
  }

  function collectTplButtons(){
    var buttons = [];
    for (var i=0;i<tplButtonsData.length;i++){
      var row = tplButtonsData[i] || [];
      var rowItems = [];
      for (var j=0;j<row.length;j++){
        var btn = row[j];
        if (!btn.text) continue;
        if (btn.type === "callback") {
          rowItems.push({ text: btn.text, type: "callback", data: btn.data || "" });
        } else {
          rowItems.push({ text: btn.text, type: "url", url: btn.url || "" });
        }
      }
      if (rowItems.length) buttons.push(rowItems);
    }
    return buttons;
  }

  function renderTplButtonsEditor(){
    var html = "";
    for (var i=0;i<tplButtonsData.length;i++){
      var row = tplButtonsData[i] || [];
      html += '<div class="btn-row" data-row="' + i + '">';
      html += '<div class="btn-row-head">';
      html += '<div class="muted">按钮行 ' + (i + 1) + '</div>';
      html += '<div>';
      html += '<button class="gray" data-action="add-btn" data-row="' + i + '">+ 按钮</button> ';
      html += '<button class="red" data-action="remove-row" data-row="' + i + '">删除行</button>';
      html += '</div></div>';
      if (!row.length) {
        html += '<div class="muted">暂无按钮，请添加。</div>';
      }
      for (var j=0;j<row.length;j++){
        var btn = row[j];
        var value = btn.type === "callback" ? (btn.data || "") : (btn.url || "");
        var placeholder = btn.type === "callback" ? "回调数据" : "https:// 链接";
        html += '<div class="btn-item">';
        html += '<input class="btn-text" data-row="' + i + '" data-idx="' + j + '" value="' + escapeHtml(btn.text || "") + '" placeholder="按钮文字" />';
        html += '<select class="btn-type" data-row="' + i + '" data-idx="' + j + '">';
        html += '<option value="url"' + (btn.type === "url" ? " selected" : "") + '>链接</option>';
        html += '<option value="callback"' + (btn.type === "callback" ? " selected" : "") + '>回调</option>';
        html += '</select>';
        html += '<input class="btn-value" data-row="' + i + '" data-idx="' + j + '" value="' + escapeHtml(value) + '" placeholder="' + placeholder + '" />';
        html += '<button class="red" data-action="remove-btn" data-row="' + i + '" data-idx="' + j + '">×</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    $("tplButtonsEditor").innerHTML = html;
  }

  $("tplButtonsEditor").addEventListener("input", function(e){
    var row = e.target.getAttribute("data-row");
    var idx = e.target.getAttribute("data-idx");
    if (row === null || idx === null) return;
    row = Number(row);
    idx = Number(idx);
    var btn = tplButtonsData[row] && tplButtonsData[row][idx];
    if (!btn) return;
    if (e.target.classList.contains("btn-text")) {
      btn.text = e.target.value;
    }
    if (e.target.classList.contains("btn-value")) {
      if (btn.type === "callback") btn.data = e.target.value;
      else btn.url = e.target.value;
    }
  });

  $("tplButtonsEditor").addEventListener("change", function(e){
    if (!e.target.classList.contains("btn-type")) return;
    var row = Number(e.target.getAttribute("data-row"));
    var idx = Number(e.target.getAttribute("data-idx"));
    var btn = tplButtonsData[row] && tplButtonsData[row][idx];
    if (!btn) return;
    btn.type = e.target.value === "callback" ? "callback" : "url";
    renderTplButtonsEditor();
  });

  $("tplButtonsEditor").addEventListener("click", function(e){
    var action = e.target.getAttribute("data-action");
    if (!action) return;
    var row = Number(e.target.getAttribute("data-row"));
    var idx = e.target.getAttribute("data-idx");
    if (action === "add-btn") {
      if (!tplButtonsData[row]) tplButtonsData[row] = [];
      tplButtonsData[row].push({ text: "", type: "url", url: "", data: "" });
      renderTplButtonsEditor();
    }
    if (action === "remove-row") {
      tplButtonsData.splice(row, 1);
      renderTplButtonsEditor();
    }
    if (action === "remove-btn") {
      if (tplButtonsData[row]) tplButtonsData[row].splice(Number(idx), 1);
      renderTplButtonsEditor();
    }
  });

  $("tplAddRow").onclick = function(){
    tplButtonsData.push([{ text: "", type: "url", url: "", data: "" }]);
    renderTplButtonsEditor();
  };

  function applyEditorCommand(command, value){
    var editor = $("tplTextEditor");
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value || null);
  }

  document.querySelector(".toolbar").addEventListener("click", function(e){
    var format = e.target.getAttribute("data-format");
    if (!format) return;
    if (format === "bold") applyEditorCommand("bold");
    if (format === "italic") applyEditorCommand("italic");
    if (format === "underline") applyEditorCommand("underline");
    if (format === "strike") applyEditorCommand("strikeThrough");
    if (format === "link") {
      var url = prompt("请输入链接地址（https://）");
      if (url) applyEditorCommand("createLink", url);
    }
  });

  async function editTpl(key){
    try{
      var d = await api("/api/admin/templates/" + encodeURIComponent(key));
      $("tplEditorTitle").textContent = key === IMAGE_REPLY_TEMPLATE_KEY ? "图片回复模版" : "编辑模板";
      $("tplKey").value = d.item.key;
      $("tplKey").disabled = true;
      $("tplTitle").value = d.item.title || "";
      $("tplDisablePreview").value = d.item.disable_preview ? "1" : "0";
      setTplEditorHtml(d.item.text || "");
      tplButtonsData = normalizeButtonsData(d.item.buttons || []);
      renderTplButtonsEditor();
      $("tplMsg").textContent = "";

      $("tplDelete").onclick = async function(){
        if(!confirm("确定删除该模板？")) return;
        try{
          await api("/api/admin/templates/" + encodeURIComponent(key), { method:"DELETE" });
          $("tplMsg").textContent = "已删除";
          location.href = "/admin#templates";
        }catch(e){
          $("tplMsg").textContent = "删除失败：" + e.message;
        }
      };
    }catch(e){
      if (key === IMAGE_REPLY_TEMPLATE_KEY) {
        openNewTpl({
          key: IMAGE_REPLY_TEMPLATE_KEY,
          headerTitle: "图片回复模版",
          title: "图片回复模版",
          disablePreview: 1,
          text: IMAGE_REPLY_DEFAULT_TEXT,
          buttons: IMAGE_REPLY_DEFAULT_BUTTONS,
          lockKey: true
        });
        return;
      }
      $("tplMsg").textContent = "加载失败：" + e.message;
    }
  }

  $("newTplBtn").onclick = function(){
    location.href = "/admin?view=template&new=1";
  };

  function openNewTpl(opts){
    var data = opts || {};
    $("tplEditorTitle").textContent = data.headerTitle || "新增模板";
    $("tplKey").value = data.key || "";
    $("tplKey").disabled = !!data.lockKey;
    $("tplTitle").value = data.title || "";
    $("tplDisablePreview").value = data.disablePreview ? "1" : "0";
    setTplEditorHtml(data.text || "");
    tplButtonsData = normalizeButtonsData(data.buttons || []);
    renderTplButtonsEditor();
    $("tplMsg").textContent = "";
    $("tplDelete").onclick = null;
  }

  $("tplSave").onclick = async function(){
    $("tplMsg").textContent = "";
    var key = $("tplKey").value.trim();
    if(!key) return $("tplMsg").textContent = "Key 不能为空";
    var body = {
      key: key,
      title: $("tplTitle").value.trim(),
      disable_preview: Number($("tplDisablePreview").value),
      text: getTplEditorHtml(),
      buttons: collectTplButtons()
    };
    try{
      await api("/api/admin/templates/" + encodeURIComponent(key), { method:"PUT", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
      $("tplMsg").textContent = "已保存";
      location.href = "/admin#templates";
    }catch(e){
      $("tplMsg").textContent = "保存失败：" + e.message;
    }
  };

  $("tplPreviewBtn").onclick = async function(){
    $("tplMsg").textContent = "";
    var key = $("tplKey").value.trim() || "preview";
    try{
      await api("/api/admin/templates/preview", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({
          key: key,
          title: $("tplTitle").value.trim(),
          disable_preview: Number($("tplDisablePreview").value),
          text: getTplEditorHtml(),
          buttons: collectTplButtons()
        })
      });
      $("tplMsg").textContent = "已发送到你的私聊";
    }catch(e){
      $("tplMsg").textContent = "发送失败：" + e.message;
    }
  };

  $("tplCancel").onclick = function(){
    location.href = "/admin#templates";
  };

  $("tplBack").onclick = function(){
    location.href = "/admin#templates";
  };

  function loadTemplateEditorFromUrl(){
    var params = new URLSearchParams(location.search);
    if (params.get("view") !== "template") return;
    var key = params.get("key");
    if (key) {
      editTpl(key);
    } else {
      openNewTpl();
    }
  }

  // Broadcast
  var templateTitleMap = {};
  async function loadTemplateTitles(){
    try{
      var d = await api("/api/admin/templates");
      templateTitleMap = {};
      var items = d.items || [];
      for (var i=0;i<items.length;i++){
        templateTitleMap[items[i].key] = items[i].title || "";
      }
    }catch(e){
      templateTitleMap = {};
    }
  }

  function updateTemplateTitleDisplay(key, targetId){
    var title = templateTitleMap[key] || "";
    $(targetId).value = title || "";
  }

  async function loadBroadcastJobs(){
    try{
      var d = await api("/api/admin/broadcast/jobs");
      var rows = "";
      var items = d.items || [];
      for (var i=0;i<items.length;i++){
        var j = items[i];
        rows += '<tr>';
        rows += '<td><b>' + escapeHtml(j.job_id) + '</b><div class="muted">' + escapeHtml(j.audience) + ' / ' + escapeHtml(j.template_key) + '</div></td>';
        rows += '<td>' + escapeHtml(j.status) + '</td>';
        rows += '<td>' + j.total + '</td>';
        rows += '<td>' + j.ok + '</td>';
        rows += '<td>' + j.fail + '</td>';
        rows += '<td>' + escapeHtml(j.created_at) + '</td>';
        rows += '</tr>';
      }
      $("bcJobs").innerHTML = '<table class="table-edge bc-jobs-table"><thead><tr><th>任务</th><th>状态</th><th>总数</th><th>成功</th><th>失败</th><th>创建时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }catch(e){
      $("bcJobs").textContent = "请先登录。";
    }
  }

  $("bcTplKey").oninput = function(){
    updateTemplateTitleDisplay($("bcTplKey").value.trim(), "bcTplTitle");
  };

  $("bcCreate").onclick = async function(){
    var audience = $("bcAudience").value;
    var template_key = $("bcTplKey").value.trim();
    if(!template_key) return alert("模板Key不能为空");
    try{
      var d = await api("/api/admin/broadcast/create", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ audience: audience, template_key: template_key }) });
      alert("已创建广播任务：" + d.job_id + "（将自动分批发送）");
      await loadBroadcastJobs();
    }catch(e){
      alert("创建失败：" + e.message);
    }
  };


  (async function(){
    var userId = await whoami();
    var params = new URLSearchParams(location.search);
    if (params.get("view") === "template") {
      showView("template-editor");
      return;
    }
    var h = location.hash.replace("#","") || "login";
    if (userId && (!location.hash || h === "login")) {
      location.hash = "#dashboard";
      h = "dashboard";
    }
    showView(h);
  })();

  // Members
  var memberPage = 1;
  var memberQuery = "";
  async function loadMembers(){
    try{
      var params = new URLSearchParams();
      params.set("page", String(memberPage));
      params.set("page_size", "10");
      if (memberQuery) params.set("q", memberQuery);
      var d = await api("/api/admin/memberships?" + params.toString());
      var rows = "";
      var items = d.items || [];
      for (var i=0;i<items.length;i++){
        var m = items[i];
        var name = escapeHtml(m.display_name || "未知用户");
        var link = m.profile_link ? '<a href="' + escapeHtml(m.profile_link) + '" target="_blank">' + name + '</a>' : name;
        rows += '<tr>';
        rows += '<td>' + link + '</td>';
        rows += '<td><b>' + m.user_id + '</b></td>';
        rows += '<td>' + escapeHtml(m.verified_at || "") + '</td>';
        rows += '<td>' + escapeHtml(m.days_left_label || "") + '</td>';
        rows += '<td class="cell-actions col-actions"><button class="gray action-btn" data-member="' + m.user_id + '">调整期限</button></td>';
        rows += '</tr>';
      }
      $("memberTable").innerHTML = '<table class="table-edge center-2-4 compact-table"><thead><tr><th>用户昵称</th><th>用户ID</th><th>成为会员</th><th>会员余期</th><th class="col-actions">操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
      var btns = $("memberTable").querySelectorAll("button[data-member]");
      for (var j=0;j<btns.length;j++){
        btns[j].onclick = async function(){
          var userId = this.getAttribute("data-member");
          var val = prompt("请输入新的会员剩余天数（整数）", "30");
          if (val === null) return;
          var daysLeft = Number(val);
          if (!Number.isFinite(daysLeft)) return alert("请输入有效天数");
          try{
            await api("/api/admin/memberships/" + encodeURIComponent(userId), {
              method:"PUT",
              headers:{ "content-type":"application/json" },
              body: JSON.stringify({ days_left: daysLeft })
            });
            loadMembers();
          }catch(e){
            alert("修改失败：" + e.message);
          }
        };
      }
      renderPagination("memberPagination", d.page || memberPage, d.total_pages || 1, function(p){
        memberPage = p;
        loadMembers();
      });
    }catch(e){
      $("memberTable").textContent = "请先登录。";
    }
  }

  $("memberSearch").oninput = function(){
    memberQuery = $("memberSearch").value.trim();
    memberPage = 1;
    loadMembers();
  };

  // Users
  var userPage = 1;
  var userQuery = "";
  async function loadUsers(){
    try{
      var params = new URLSearchParams();
      params.set("page", String(userPage));
      params.set("page_size", "10");
      if (userQuery) params.set("q", userQuery);
      var d = await api("/api/admin/users?" + params.toString());
      var rows = "";
      var items = d.items || [];
      for (var i=0;i<items.length;i++){
        var u = items[i];
        var name = escapeHtml(u.display_name || "未知用户");
        var link = u.profile_link ? '<a href="' + escapeHtml(u.profile_link) + '" target="_blank">' + name + '</a>' : name;
        var dmLink = u.profile_link || ("tg://user?id=" + u.user_id);
        rows += '<tr>';
        rows += '<td>' + link + '</td>';
        rows += '<td><b>' + u.user_id + '</b></td>';
        rows += '<td>' + escapeHtml(u.first_seen_at || "") + '</td>';
        rows += '<td>' + escapeHtml(u.status_label || "") + '</td>';
        rows += '<td class="cell-actions col-actions"><a class="btn-link action-btn" href="' + escapeHtml(dmLink) + '" target="_blank">私信</a></td>';
        rows += '</tr>';
      }
      $("userTable").innerHTML = '<table class="table-edge center-2-4 compact-table"><thead><tr><th>用户昵称</th><th>用户ID</th><th>关注日期</th><th>状态</th><th class="col-actions">操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
      renderPagination("userPagination", d.page || userPage, d.total_pages || 1, function(p){
        userPage = p;
        loadUsers();
      });
    }catch(e){
      $("userTable").textContent = "请先登录。";
    }
  }

  $("userSearch").oninput = function(){
    userQuery = $("userSearch").value.trim();
    userPage = 1;
    loadUsers();
  };

</script>
</body>
</html>`;
}

export function wallpaperHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>欢迎</title>
  <style>
    html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0b2a4a;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .bg{position:fixed;inset:0;background-size:cover;background-position:center;transition:opacity 1s ease}
    #background-next{opacity:0}
    #background-next.show{opacity:1}
  </style>
</head>
<body>
  <div id="background" class="bg"></div>
  <div id="background-next" class="bg"></div>
  <script>
    async function fetchBingImages() {
      const response = await fetch('/bing-images');
      if (!response.ok) return [];
      const data = await response.json();
      return (data.data || []).map(image => image.url).filter(Boolean);
    }

    async function setBackgroundImages() {
      const images = await fetchBingImages();
      const backgroundDiv = document.getElementById('background');
      const nextBackgroundDiv = document.getElementById('background-next');
      if (images.length > 0) {
        backgroundDiv.style.backgroundImage = 'url(' + images[0] + ')';
      }

      let index = 0;
      setInterval(() => {
        if (!images.length) return;
        const nextIndex = (index + 1) % images.length;
        nextBackgroundDiv.style.backgroundImage = 'url(' + images[nextIndex] + ')';
        nextBackgroundDiv.classList.add('show');
        setTimeout(() => {
          backgroundDiv.style.backgroundImage = nextBackgroundDiv.style.backgroundImage;
          nextBackgroundDiv.classList.remove('show');
        }, 1000);
        index = nextIndex;
      }, 5000);
    }

    setBackgroundImages();
  </script>
</body>
</html>`;
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

export async function adminApi(env, req, pathname) {
  // Login endpoints don't require session
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const { code } = await req.json();
    const uidStr = await getKv(env).get(`admin_login_code:${String(code).trim()}`);
    if (!uidStr) return new Response(JSON.stringify({ ok:false, error:"登录码无效或已过期" }), { status: 401, headers: JSON_HEADERS });
    const userId = Number(uidStr);
    const adminIds = parseAdminIds(env);
    if (!adminIds.includes(userId)) return new Response(JSON.stringify({ ok:false, error:"无权限" }), { status: 403, headers: JSON_HEADERS });

    const token = await createAdminSession(env, userId);
    // invalidate code
    await getKv(env).delete(`admin_login_code:${String(code).trim()}`);
    return new Response(JSON.stringify({ ok:true }), {
      headers: {
        ...JSON_HEADERS,
        "set-cookie": `admin_session=${token}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${7*24*3600}`,
      }
    });
  }

  if (pathname === "/api/admin/logout" && req.method === "POST") {
    const cookie = req.headers.get("cookie") || "";
    const m = cookie.match(/admin_session=([A-Za-z0-9_-]+)/);
    if (m) await getKv(env).delete(`admin_session:${m[1]}`);
    return new Response(JSON.stringify({ ok:true }), {
      headers: { ...JSON_HEADERS, "set-cookie": "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" }
    });
  }

  const userId = await isAdminSession(env, req);
  if (!userId) return new Response(JSON.stringify({ ok:false, error:"未登录" }), { status: 401, headers: JSON_HEADERS });
  const url = new URL(req.url);

  if (pathname === "/api/admin/whoami") {
    return new Response(JSON.stringify({ ok:true, user_id: userId }), { headers: JSON_HEADERS });
  }

  if (pathname === "/api/admin/dashboard") {
    const now = nowSec();
    const tz = env.TZ || "Asia/Shanghai";
    const todayStart = getTzDayStart(now, tz);
    const tomorrowStart = todayStart + 86400;
    const weekStart = getTzWeekStart(now, tz);
    const nextWeekStart = weekStart + 7 * 86400;
    const lastWeekStart = weekStart - 7 * 86400;

    const total_users = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users`).first()).c;
    const members = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM memberships WHERE expire_at > ?`).bind(now).first()).c;
    const expiring_7d = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM memberships WHERE expire_at BETWEEN ? AND ?`).bind(now, now + 7 * 86400).first()).c;
    const expired = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM memberships WHERE expire_at <= ?`).bind(now).first()).c;
    const week_follow = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users WHERE first_seen_at BETWEEN ? AND ?`).bind(weekStart, nextWeekStart).first()).c;
    const week_unsub = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users WHERE can_dm=0 AND last_seen_at BETWEEN ? AND ?`).bind(weekStart, nextWeekStart).first()).c;
    const last_week_follow = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users WHERE first_seen_at BETWEEN ? AND ?`).bind(lastWeekStart, weekStart).first()).c;
    const last_week_unsub = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users WHERE can_dm=0 AND last_seen_at BETWEEN ? AND ?`).bind(lastWeekStart, weekStart).first()).c;
    const tzParts = getTzParts(new Date(now * 1000), tz);
    const monthStart = todayStart - (tzParts.day - 1) * 86400;
    const month_follow = (await getDb(env).prepare(`SELECT COUNT(*) AS c FROM users WHERE first_seen_at BETWEEN ? AND ?`).bind(monthStart, tomorrowStart).first()).c;
    const weekSeriesStart = todayStart - 6 * 86400;
    const weekRows = await getDb(env).prepare(
      `SELECT first_seen_at FROM users WHERE first_seen_at BETWEEN ? AND ?`
    ).bind(weekSeriesStart, tomorrowStart - 1).all();
    const weekBuckets = {};
    for (const row of (weekRows.results || [])) {
      const key = getTzDateKey(row.first_seen_at, tz);
      weekBuckets[key] = (weekBuckets[key] || 0) + 1;
    }
    const weekly_follow_series = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = weekSeriesStart + i * 86400;
      const key = getTzDateKey(dayStart, tz);
      const labelParts = key.split("-");
      const label = `${labelParts[1]}-${labelParts[2]}`;
      weekly_follow_series.push({ date: label, count: weekBuckets[key] || 0 });
    }
    const kv = getKv(env);
    let week_images = 0;
    let month_images = 0;
    const weekly_image_series = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = weekSeriesStart + i * 86400;
      const key = getTzDateKey(dayStart, tz);
      const dayTotal = Number(await kv.get(`image_total:${key}`) || 0);
      const dayUsers = Number(await kv.get(`image_user_total:${key}`) || 0);
      const labelParts = key.split("-");
      const label = `${labelParts[1]}-${labelParts[2]}`;
      weekly_image_series.push({ date: label, count: dayTotal, users: dayUsers });
    }
    const weekDays = Math.max(0, Math.floor((tomorrowStart - weekStart) / 86400));
    for (let i = 0; i < weekDays; i++) {
      const key = getTzDateKey(weekStart + i * 86400, tz);
      week_images += Number(await kv.get(`image_total:${key}`) || 0);
    }
    const monthDays = Math.max(0, Math.floor((tomorrowStart - monthStart) / 86400));
    for (let i = 0; i < monthDays; i++) {
      const key = getTzDateKey(monthStart + i * 86400, tz);
      month_images += Number(await kv.get(`image_total:${key}`) || 0);
    }
    return new Response(JSON.stringify({
      ok:true,
      total_users,
      members,
      expiring_7d,
      expired,
      week_follow,
      week_unsub,
      last_week_follow,
      last_week_unsub,
      month_follow,
      week_images,
      month_images,
      weekly_follow_series,
      weekly_image_series
    }), { headers: JSON_HEADERS });
  }

  if (pathname === "/api/admin/webhook" && req.method === "GET") {
    const info = await tgCall(env, "getWebhookInfo", {});
    const data = {
      url: info.url || "",
      pending_update_count: info.pending_update_count || 0,
      last_error_message: info.last_error_message || "",
      last_error_date: info.last_error_date ? fmtDateTime(info.last_error_date, env.TZ) : "",
      ip_address: info.ip_address || ""
    };
    return new Response(JSON.stringify({ ok:true, info: data }), { headers: JSON_HEADERS });
  }

  if (pathname === "/api/admin/webhook" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const origin = new URL(req.url).origin;
    const url = String(body.url || `${origin}/tg/webhook`).trim();
    if (!url.startsWith("https://")) {
      return new Response(JSON.stringify({ ok:false, error:"Webhook 必须使用 https://" }), { status: 400, headers: JSON_HEADERS });
    }
    await tgCall(env, "setWebhook", {
      url,
      allowed_updates: ["message", "callback_query"],
    });
    return new Response(JSON.stringify({ ok:true, url }), { headers: JSON_HEADERS });
  }

  // Templates list
  if (pathname === "/api/admin/templates" && req.method === "GET") {
    const orderCase = TEMPLATE_SORT_ORDER.map((k, idx) => `WHEN '${k}' THEN ${idx + 1}`).join(" ");
    const rows = await getDb(env).prepare(
      `SELECT key,title,text,buttons_json,updated_at
       FROM templates
       WHERE key != 'join_denied'
       ORDER BY CASE key ${orderCase} ELSE 999 END, key`
    ).all();
    const items = (rows.results || []).map(r => ({
      key: r.key,
      title: r.title,
      text: r.text,
      btn_rows: (JSON.parse(r.buttons_json||"[]")||[]).length,
      updated_at: fmtDateTime(r.updated_at, env.TZ),
      is_system: ["start","vip_new","vip_renew"].includes(r.key)
    }));
    return new Response(JSON.stringify({ ok:true, items }), { headers: JSON_HEADERS });
  }

  if (pathname === "/api/admin/templates/preview" && req.method === "POST") {
    const body = await req.json();
    const text = normalizeTelegramHtml(String(body.text || ""));
    const buttons = Array.isArray(body.buttons) ? body.buttons : [];
    const disablePreview = Number(body.disable_preview || 0) ? true : false;
    const payload = {
      chat_id: userId,
      text: text || "(空模板)",
      parse_mode: "HTML",
      disable_web_page_preview: disablePreview
    };
    if (buttons.length) payload.reply_markup = buildKeyboard(buttons);
    await tgCall(env, "sendMessage", payload);
    return new Response(JSON.stringify({ ok:true }), { headers: JSON_HEADERS });
  }

  // Get template
  if (pathname.startsWith("/api/admin/templates/") && req.method === "GET") {
    const key = decodeURIComponent(pathname.split("/").pop());
    const tpl = await getDb(env).prepare(`SELECT key,title,parse_mode,disable_preview,text,buttons_json,updated_at FROM templates WHERE key=?`).bind(key).first();
    if (!tpl) return new Response(JSON.stringify({ ok:false, error:"模板不存在" }), { status: 404, headers: JSON_HEADERS });
    return new Response(JSON.stringify({
      ok:true,
      item: {
        key: tpl.key, title: tpl.title, parse_mode: tpl.parse_mode, disable_preview: tpl.disable_preview,
        text: tpl.text, buttons: JSON.parse(tpl.buttons_json||"[]"),
        updated_at: tpl.updated_at
      }
    }), { headers: JSON_HEADERS });
  }

  // Upsert template
  if (pathname.startsWith("/api/admin/templates/") && req.method === "PUT") {
    const key = decodeURIComponent(pathname.split("/").pop());
    const body = await req.json();
    const t = nowSec();
    await getDb(env).prepare(
      `INSERT INTO templates(key,title,parse_mode,disable_preview,text,buttons_json,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET title=excluded.title, disable_preview=excluded.disable_preview, text=excluded.text, buttons_json=excluded.buttons_json, updated_at=excluded.updated_at`
    ).bind(
      key,
      body.title || "",
      "HTML",
      Number(body.disable_preview||0),
      body.text || "",
      JSON.stringify(body.buttons || []),
      t
    ).run();
    return new Response(JSON.stringify({ ok:true }), { headers: JSON_HEADERS });
  }

  // Delete template
  if (pathname.startsWith("/api/admin/templates/") && req.method === "DELETE") {
    const key = decodeURIComponent(pathname.split("/").pop());
    await getDb(env).prepare(`DELETE FROM templates WHERE key=?`).bind(key).run();
    return new Response(JSON.stringify({ ok:true }), { headers: JSON_HEADERS });
  }

  // Broadcast jobs
  if (pathname === "/api/admin/broadcast/create" && req.method === "POST") {
    const body = await req.json();
    const audience = ["all","member","nonmember"].includes(body.audience) ? body.audience : "all";
    const template_key = String(body.template_key || "").trim();
    const tpl = await getDb(env).prepare(`SELECT key FROM templates WHERE key=?`).bind(template_key).first();
    if (!tpl) return new Response(JSON.stringify({ ok:false, error:"模板不存在" }), { status: 400, headers: JSON_HEADERS });

    const job_id = crypto.randomUUID();
    const t = nowSec();
    // Estimate audience size
    let q = `SELECT COUNT(*) AS c FROM users WHERE can_dm=1`;
    let bind = [];
    if (audience === "member") { q = `SELECT COUNT(*) AS c FROM memberships m JOIN users u ON u.user_id=m.user_id WHERE u.can_dm=1 AND m.expire_at > ?`; bind=[nowSec()]; }
    if (audience === "nonmember") { q = `SELECT COUNT(*) AS c FROM users u LEFT JOIN memberships m ON m.user_id=u.user_id WHERE u.can_dm=1 AND (m.user_id IS NULL OR m.expire_at <= ?)`; bind=[nowSec()]; }
    const total = (await getDb(env).prepare(q).bind(...bind).first()).c;

    await getDb(env).prepare(`INSERT INTO broadcast_jobs(job_id,audience,template_key,created_at,status,total) VALUES (?,?,?,?,?,?)`)
      .bind(job_id, audience, template_key, t, "pending", total).run();
    return new Response(JSON.stringify({ ok:true, job_id }), { headers: JSON_HEADERS });
  }

  if (pathname === "/api/admin/broadcast/jobs" && req.method === "GET") {
    const rows = await getDb(env).prepare(`SELECT job_id,audience,template_key,created_at,status,total,ok,fail FROM broadcast_jobs ORDER BY created_at DESC LIMIT 50`).all();
    const items = (rows.results || []).map(r => ({
      job_id: r.job_id,
      audience: r.audience,
      template_key: r.template_key,
      created_at: fmtDateTime(r.created_at, env.TZ),
      status: r.status,
      total: r.total,
      ok: r.ok,
      fail: r.fail
    }));
    return new Response(JSON.stringify({ ok:true, items }), { headers: JSON_HEADERS });
  }

  // Memberships
  if (pathname === "/api/admin/memberships" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || 10)));
    const offset = (page - 1) * pageSize;
    let where = "";
    let bind = [];
    if (q) {
      const like = `%${q}%`;
      where = "WHERE CAST(u.user_id AS TEXT) LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?";
      bind = [like, like, like, like];
    }
    const countRow = await getDb(env).prepare(
      `SELECT COUNT(*) AS c
       FROM memberships m
       JOIN users u ON u.user_id=m.user_id
       ${where}`
    ).bind(...bind).first();
    const total = countRow?.c || 0;
    const rows = await getDb(env).prepare(
      `SELECT m.user_id,m.verified_at,m.expire_at,u.username,u.first_name,u.last_name
       FROM memberships m
       JOIN users u ON u.user_id=m.user_id
       ${where}
       ORDER BY m.expire_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...bind, pageSize, offset).all();
    const now = nowSec();
    const items = (rows.results || []).map(r => {
      const display = buildUserDisplay(r);
      const daysLeft = Math.max(0, Math.ceil((r.expire_at - now) / 86400));
      return {
        user_id: r.user_id,
        verified_at: fmtDateTime(r.verified_at, env.TZ),
        days_left: daysLeft,
        days_left_label: `${daysLeft} 天`,
        display_name: display.displayName,
        profile_link: display.profileLink
      };
    });
    return new Response(JSON.stringify({
      ok:true,
      items,
      page,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize))
    }), { headers: JSON_HEADERS });
  }

  if (pathname.startsWith("/api/admin/memberships/") && req.method === "PUT") {
    const targetId = Number(decodeURIComponent(pathname.split("/").pop()));
    if (!Number.isFinite(targetId)) return new Response(JSON.stringify({ ok:false, error:"用户ID无效" }), { status: 400, headers: JSON_HEADERS });
    const body = await req.json();
    const daysLeft = Number(body.days_left || 0);
    if (!Number.isFinite(daysLeft)) return new Response(JSON.stringify({ ok:false, error:"天数无效" }), { status: 400, headers: JSON_HEADERS });
    const t = nowSec();
    const expireAt = t + Math.max(0, Math.floor(daysLeft)) * 86400;
    await getDb(env).prepare(
      `INSERT INTO memberships(user_id,verified_at,expire_at,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET expire_at=excluded.expire_at, updated_at=excluded.updated_at`
    ).bind(targetId, t, expireAt, t).run();
    return new Response(JSON.stringify({ ok:true }), { headers: JSON_HEADERS });
  }

  // Users
  if (pathname === "/api/admin/users" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || 10)));
    const offset = (page - 1) * pageSize;
    let where = "";
    let bind = [];
    if (q) {
      const like = `%${q}%`;
      where = "WHERE CAST(u.user_id AS TEXT) LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?";
      bind = [like, like, like, like];
    }
    const countRow = await getDb(env).prepare(
      `SELECT COUNT(*) AS c
       FROM users u
       ${where}`
    ).bind(...bind).first();
    const total = countRow?.c || 0;
    const rows = await getDb(env).prepare(
      `SELECT u.user_id,u.can_dm,u.first_seen_at,u.last_seen_at,u.username,u.first_name,u.last_name
       FROM users u
       ${where}
       ORDER BY u.last_seen_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...bind, pageSize, offset).all();
    const now = nowSec();
    const items = (rows.results || []).map(r => {
      const display = buildUserDisplay(r);
      return {
        user_id: r.user_id,
        can_dm: r.can_dm === 1,
        first_seen_at: fmtDateTime(r.first_seen_at, env.TZ),
        status_label: buildUserStatusLabel(r, now),
        display_name: display.displayName,
        profile_link: display.profileLink
      };
    });
    return new Response(JSON.stringify({
      ok:true,
      items,
      page,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize))
    }), { headers: JSON_HEADERS });
  }

  if (pathname.startsWith("/api/admin/users/") && req.method === "PUT") {
    const targetId = Number(decodeURIComponent(pathname.split("/").pop()));
    if (!Number.isFinite(targetId)) return new Response(JSON.stringify({ ok:false, error:"用户ID无效" }), { status: 400, headers: JSON_HEADERS });
    const body = await req.json();
    const canDm = Number(body.can_dm || 0) ? 1 : 0;
    await getDb(env).prepare(`UPDATE users SET can_dm=? WHERE user_id=?`).bind(canDm, targetId).run();
    return new Response(JSON.stringify({ ok:true }), { headers: JSON_HEADERS });
  }


  return new Response(JSON.stringify({ ok:false, error:"Not Found" }), { status: 404, headers: JSON_HEADERS });
}

export async function handleWebhook(env, update, requestUrl) {
  const requestUrlString = String(requestUrl || "");
  // Track users who DM the bot
  const msg = update.message;
  const cbq = update.callback_query;
  const myChatMember = update.my_chat_member;

  if (msg && msg.from?.id) await ensureUser(env, msg.from);
  if (myChatMember) {
    await handleBotChatMemberUpdate(env, myChatMember);
  }

  // Callback query buttons
  if (cbq) {
    const userId = cbq.from?.id;
    const chatId = cbq.message?.chat?.id;
    const data = cbq.data || "";

    // Always answer callback to avoid "loading"
    try { await tgCall(env, "answerCallbackQuery", { callback_query_id: cbq.id }); } catch {}

    if (!isPrivateChat(cbq.message)) return;

    if (data === "/start" || data === "START") {
      await sendStartTemplate(env, userId);
      return;
    }
    return;
  }

  // Messages
  if (!msg) return;
  if (!isPrivateChat(msg)) {
    await handleGroupMessage(env, msg);
    return;
  }

  const userId = msg.from?.id;
  const text = msg.text || msg.caption || "";

  // Admin commands in private chat
  if (text.startsWith("/login")) {
    const baseOrigin = requestUrlString ? new URL(requestUrlString).origin : "";
    await handleAdminLoginCommand(env, msg, baseOrigin);
    return;
  }

  if (text.startsWith("/start")) {
    await sendStartTemplate(env, userId);
    return;
  }

  if (msg.media_group_id) {
    if (await bufferSearchMediaGroup(env, msg, requestUrlString)) {
      return;
    }
  }

  if (await handleImageOrVideoMessage(env, msg, requestUrlString)) {
    return;
  }

  if (text.startsWith("/")) {
    const commandKey = text.trim().split(/\s+/)[0].slice(1).split("@")[0];
    if (commandKey) {
      const cmdTpl = await getTemplate(env, commandKey);
      if (cmdTpl) {
        await trySendMessage(env, userId, {
          chat_id: userId,
          text: normalizeTelegramHtml(cmdTpl.text),
          parse_mode: cmdTpl.parse_mode,
          disable_web_page_preview: cmdTpl.disable_preview,
          reply_markup: cmdTpl.buttons?.length ? buildKeyboard(cmdTpl.buttons) : undefined,
        });
        return;
      }
    }
  }

  // Ignore other messages
}
