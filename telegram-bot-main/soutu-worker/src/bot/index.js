import {
  DEFAULT_SEARCH_BUTTONS,
  DEFAULT_SEARCH_TEXT,
  TEMPLATE_KEYS,
} from "../config.js";
import { getTemplateByKey, pickSearchTemplate } from "../admin/index.js";
import { isMember } from "../members/index.js";
import { checkGroupQuota, checkPrivateQuota } from "../quota/index.js";
import { buildImageSearchLinks, buildSignedProxyUrl, getTelegramFilePath } from "../search/index.js";
import { tgCall } from "../telegram.js";
import { buildKeyboard, getMessageImageInfo, renderButtonsWithVars, renderTemplateText } from "../utils.js";

function isGroupChat(msg) {
  return ["group", "supergroup"].includes(msg?.chat?.type);
}

function isPrivateChat(msg) {
  return msg?.chat?.type === "private";
}

function parseCommand(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.split(/\s+/)[0].slice(1).split("@")[0];
}

function resolveImageFromMessage(msg) {
  const direct = getMessageImageInfo(msg);
  if (direct) return direct;
  const reply = msg?.reply_to_message;
  if (reply) return getMessageImageInfo(reply);
  return null;
}

async function sendTemplateOrText(env, chatId, templateKey, fallback) {
  const tpl = await getTemplateByKey(env, templateKey);
  if (tpl) {
    const buttons = JSON.parse(tpl.buttons || "[]");
    return tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: tpl.content || fallback,
      reply_markup: buttons.length ? buildKeyboard(buttons) : undefined,
    });
  }
  return tgCall(env, "sendMessage", { chat_id: chatId, text: fallback });
}

async function replyWithSearch(env, msg, requestUrl) {
  const imageInfo = resolveImageFromMessage(msg);
  if (!imageInfo) {
    return tgCall(env, "sendMessage", { chat_id: msg.chat.id, text: "请发送图片或回复图片使用 /s" });
  }
  await getTelegramFilePath(env, imageInfo.fileId, imageInfo.fileUniqueId);
  const imageUrl = await buildSignedProxyUrl(env, requestUrl, imageInfo.fileId, msg.from?.id);
  const links = buildImageSearchLinks(imageUrl);
  const template = await pickSearchTemplate(env);
  const text = renderTemplateText(template?.content || DEFAULT_SEARCH_TEXT, {
    image_url: imageUrl,
    google_lens: links.google,
    yandex: links.yandex,
  });
  const rawButtons = template?.buttons ? JSON.parse(template.buttons) : DEFAULT_SEARCH_BUTTONS;
  const buttons = renderButtonsWithVars(rawButtons, {
    image_url: imageUrl,
    google_lens: links.google,
    yandex: links.yandex,
  });
  await tgCall(env, "sendMessage", {
    chat_id: msg.chat.id,
    text,
    reply_to_message_id: msg.message_id,
    reply_markup: buttons.length ? buildKeyboard(buttons) : undefined,
  });
  await env.DB.prepare(
    "INSERT INTO search_logs(user_id, chat_type, timestamp, success) VALUES (?, ?, ?, 1)"
  ).bind(msg.from?.id, msg.chat.type, Math.floor(Date.now() / 1000)).run();
}

export async function handleWebhook(env, update, requestUrl) {
  const msg = update.message;
  if (!msg || !msg.from?.id) return new Response("ok");

  const command = parseCommand(msg.text || msg.caption || "");
  const wantsSearch = command === "s" || Boolean(resolveImageFromMessage(msg));

  if (isGroupChat(msg)) {
    if (command !== "s") return new Response("ok");
    const quota = await checkGroupQuota(env, msg.from.id);
    if (!quota.allowed) {
      await sendTemplateOrText(env, msg.chat.id, TEMPLATE_KEYS.GROUP_LIMIT, "今日群内搜图次数已用完，请明天再试。");
      return new Response("ok");
    }
    await replyWithSearch(env, msg, requestUrl);
    return new Response("ok");
  }

  if (isPrivateChat(msg)) {
    if (!wantsSearch) return new Response("ok");
    const memberOk = await isMember(env, msg.from.id);
    if (!memberOk) {
      await sendTemplateOrText(env, msg.chat.id, TEMPLATE_KEYS.PRIVATE_NON_MEMBER, "仅会员可使用私聊搜图服务。");
      return new Response("ok");
    }
    const quota = await checkPrivateQuota(env, msg.from.id);
    if (!quota.allowed) {
      await sendTemplateOrText(env, msg.chat.id, TEMPLATE_KEYS.PRIVATE_LIMIT, "今日私聊搜图次数已用完，请明天再试。");
      return new Response("ok");
    }
    await replyWithSearch(env, msg, requestUrl);
  }

  return new Response("ok");
}
