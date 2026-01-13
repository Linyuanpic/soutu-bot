import { DEFAULT_D1_BINDING, DEFAULT_KV_BINDING, REQUIRED_MANAGED_CHATS } from "./config.js";
import { resolveBindingName, nowSec } from "./utils.js";
import { getKv } from "./kv.js";

export function getDb(env) {
  const name = resolveBindingName(env, "D1_BINDING", DEFAULT_D1_BINDING);
  const db = env?.[name];
  if (db) return db;
  if (name !== DEFAULT_D1_BINDING && env?.[DEFAULT_D1_BINDING]) {
    console.warn(`D1 binding ${name} not found. Falling back to ${DEFAULT_D1_BINDING}.`);
    return env?.[DEFAULT_D1_BINDING];
  }
  return db;
}

export function validateEnv(env) {
  const issues = [];
  if (!env.BOT_TOKEN) issues.push("Missing BOT_TOKEN secret.");
  const d1Name = resolveBindingName(env, "D1_BINDING", DEFAULT_D1_BINDING);
  const kvName = resolveBindingName(env, "KV_BINDING", DEFAULT_KV_BINDING);
  if (!getDb(env)) issues.push(`Missing D1 binding: ${d1Name}.`);
  if (!getKv(env)) issues.push(`Missing KV binding: ${kvName}.`);
  if (!env.ADMIN_USER_IDS) issues.push("Missing ADMIN_USER_IDS.");
  return issues;
}

export async function ensureUser(env, user) {
  const t = nowSec();
  const userId = user?.id;
  if (!Number.isFinite(userId)) return;
  const username = user?.username || "";
  const firstName = user?.first_name || "";
  const lastName = user?.last_name || "";
  await getDb(env).prepare(
    `INSERT INTO users(user_id, can_dm, first_seen_at, last_seen_at, username, first_name, last_name)
     VALUES (?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, username=excluded.username, first_name=excluded.first_name, last_name=excluded.last_name`
  ).bind(userId, t, t, username, firstName, lastName).run();
}

export async function ensureUserById(env, userId) {
  if (!Number.isFinite(userId)) return;
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO users(user_id, can_dm, first_seen_at, last_seen_at, username, first_name, last_name)
     VALUES (?, 0, ?, ?, '', '', '')
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(userId, t, t).run();
}

export async function setCanDm(env, userId, canDm) {
  const t = nowSec();
  await getDb(env).prepare(`UPDATE users SET can_dm=?, last_seen_at=? WHERE user_id=?`).bind(canDm ? 1 : 0, t, userId).run();
}

export async function getMembership(env, userId) {
  const row = await getDb(env).prepare(`SELECT user_id, verified_at, expire_at FROM memberships WHERE user_id=?`).bind(userId).first();
  return row || null;
}

export async function getTemplate(env, key) {
  const row = await getDb(env).prepare(`SELECT key,title,parse_mode,disable_preview,text,buttons_json FROM templates WHERE key=?`).bind(key).first();
  if (!row) return null;
  let buttons = [];
  try {
    buttons = JSON.parse(row.buttons_json || "[]");
  } catch {
    buttons = [];
  }
  return {
    key: row.key,
    title: row.title,
    parse_mode: row.parse_mode || "HTML",
    disable_preview: row.disable_preview ? true : false,
    text: row.text || "",
    buttons,
  };
}

export async function getSetting(env, key, fallback = "") {
  const row = await getDb(env).prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first();
  if (row && typeof row.value === "string") return row.value;
  return fallback;
}

export async function setSetting(env, key, value) {
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO settings(key,value,updated_at)
     VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).bind(key, value, t).run();
}

export async function upsertManagedChat(env, chat) {
  const chatId = chat?.id;
  const chatType = chat?.type;
  if (!Number.isFinite(chatId)) return;
  if (!["group", "supergroup", "channel"].includes(chatType)) return;
  const normalizedType = chatType === "supergroup" ? "group" : chatType;
  const title = chat?.title || chat?.username || "";
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO managed_chats(chat_id, chat_type, title, is_enabled, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(chat_id) DO UPDATE SET chat_type=excluded.chat_type, title=excluded.title, is_enabled=1`
  ).bind(chatId, normalizedType, title, 1, t).run();
}

export async function addManagedChat(env, chatId, chatType, title = "", isEnabled = 1) {
  if (!Number.isFinite(chatId)) return;
  if (!["group", "supergroup", "channel"].includes(chatType)) return;
  const normalizedType = chatType === "supergroup" ? "group" : chatType;
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO managed_chats(chat_id, chat_type, title, is_enabled, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(chat_id) DO UPDATE SET chat_type=excluded.chat_type, title=excluded.title, is_enabled=excluded.is_enabled`
  ).bind(chatId, normalizedType, title, Number(isEnabled) ? 1 : 0, t).run();
}

export async function listManagedChats(env, enabledOnly = false) {
  const where = enabledOnly ? "WHERE is_enabled=1" : "";
  const rows = await getDb(env).prepare(
    `SELECT chat_id, chat_type, title, is_enabled, created_at
     FROM managed_chats
     ${where}
     ORDER BY created_at DESC`
  ).all();
  const existing = rows.results || [];
  const existingIds = new Set(existing.map(row => row.chat_id));
  const required = REQUIRED_MANAGED_CHATS.map(chat => ({
    chat_id: chat.chat_id,
    chat_type: chat.chat_type,
    title: chat.title,
    is_enabled: 1,
    created_at: 0
  })).filter(chat => !existingIds.has(chat.chat_id));
  return existing.concat(required);
}

export async function isManagedChatEnabled(env, chatId) {
  if (!Number.isFinite(chatId)) return false;
  if (REQUIRED_MANAGED_CHATS.some(chat => chat.chat_id === chatId)) return true;
  const row = await getDb(env).prepare(`SELECT is_enabled FROM managed_chats WHERE chat_id=?`).bind(chatId).first();
  return row?.is_enabled === 1;
}

export async function updateManagedChatStatus(env, chatId, isEnabled) {
  if (!Number.isFinite(chatId)) return;
  await getDb(env).prepare(`UPDATE managed_chats SET is_enabled=? WHERE chat_id=?`).bind(Number(isEnabled) ? 1 : 0, chatId).run();
}

export async function upsertUserChatMembership(env, userId, chatId) {
  if (!Number.isFinite(userId) || !Number.isFinite(chatId)) return;
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO user_chats(user_id, chat_id, approved_at, removed_at)
     VALUES (?,?,?,NULL)
     ON CONFLICT(user_id, chat_id) DO UPDATE SET approved_at=excluded.approved_at, removed_at=NULL`
  ).bind(userId, chatId, t).run();
}

export async function markUserChatRemoved(env, userId, chatId) {
  if (!Number.isFinite(userId) || !Number.isFinite(chatId)) return;
  const t = nowSec();
  await getDb(env).prepare(`UPDATE user_chats SET removed_at=? WHERE user_id=? AND chat_id=?`).bind(t, userId, chatId).run();
}
