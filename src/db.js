import {
  DEFAULT_D1_BINDING,
  DEFAULT_KV_BINDING,
  IMAGE_REPLY_DEFAULT_BUTTONS,
  IMAGE_REPLY_DEFAULT_TEXT,
  START_DEFAULT_BUTTONS,
  START_DEFAULT_TEXT,
} from "./config.js";
import { resolveBindingName, nowSec } from "./utils.js";
import { getKv } from "./kv.js";

let schemaReady;

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

export async function ensureSchema(env) {
  const db = getDb(env);
  if (!db) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY,
          can_dm INTEGER NOT NULL DEFAULT 1,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          username TEXT,
          first_name TEXT,
          last_name TEXT
        )`
      ).run();
      const userColumns = await db.prepare(`PRAGMA table_info('users')`).all();
      const hasCanDm = userColumns?.results?.some((col) => col?.name === "can_dm");
      if (!hasCanDm) {
        await db.prepare(`ALTER TABLE users ADD COLUMN can_dm INTEGER NOT NULL DEFAULT 1`).run();
      }
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS vip_members (
          user_id INTEGER PRIMARY KEY,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )`
      ).run();
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS managed_chats (
          chat_id INTEGER PRIMARY KEY,
          chat_type TEXT NOT NULL CHECK(chat_type IN ('group','channel')),
          title TEXT,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        )`
      ).run();
      const managedChatColumns = await db.prepare(`PRAGMA table_info('managed_chats')`).all();
      const hasManagedChatTitle = managedChatColumns?.results?.some((col) => col?.name === "title");
      if (!hasManagedChatTitle) {
        await db.prepare(`ALTER TABLE managed_chats ADD COLUMN title TEXT`).run();
      }
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS templates (
          key TEXT PRIMARY KEY,
          title TEXT,
          parse_mode TEXT NOT NULL DEFAULT 'HTML',
          disable_preview INTEGER NOT NULL DEFAULT 0,
          text TEXT NOT NULL,
          buttons_json TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        )`
      ).run();
      const templateColumns = await db.prepare(`PRAGMA table_info('templates')`).all();
      const hasTemplateTitle = templateColumns?.results?.some((col) => col?.name === "title");
      if (!hasTemplateTitle) {
        await db.prepare(`ALTER TABLE templates ADD COLUMN title TEXT`).run();
      }
      const hasTemplateParseMode = templateColumns?.results?.some((col) => col?.name === "parse_mode");
      if (!hasTemplateParseMode) {
        await db.prepare(`ALTER TABLE templates ADD COLUMN parse_mode TEXT NOT NULL DEFAULT 'HTML'`).run();
      }
      const hasTemplateDisablePreview = templateColumns?.results?.some((col) => col?.name === "disable_preview");
      if (!hasTemplateDisablePreview) {
        await db.prepare(`ALTER TABLE templates ADD COLUMN disable_preview INTEGER NOT NULL DEFAULT 0`).run();
      }
      const hasTemplateButtonsJson = templateColumns?.results?.some((col) => col?.name === "buttons_json");
      if (!hasTemplateButtonsJson) {
        await db.prepare(`ALTER TABLE templates ADD COLUMN buttons_json TEXT NOT NULL DEFAULT '[]'`).run();
      }
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS broadcast_jobs (
          job_id TEXT PRIMARY KEY,
          audience TEXT NOT NULL CHECK(audience IN ('all','member','nonmember')),
          template_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending','sending','done')) DEFAULT 'pending',
          total INTEGER NOT NULL DEFAULT 0,
          ok INTEGER NOT NULL DEFAULT 0,
          fail INTEGER NOT NULL DEFAULT 0
        )`
      ).run();
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS broadcast_logs (
          job_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ok','fail')),
          error_code INTEGER,
          error_msg TEXT,
          sent_at INTEGER NOT NULL
        )`
      ).run();
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS image_hosts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          base_url TEXT NOT NULL UNIQUE,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          fail_count INTEGER NOT NULL DEFAULT 0,
          is_faulty INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`
      ).run();
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      ).run();
      const t = nowSec();
      const defaultTemplates = [
        {
          key: "start",
          title: "/start 首页",
          disable_preview: 0,
          text: START_DEFAULT_TEXT,
          buttons: START_DEFAULT_BUTTONS,
        },
        {
          key: "image_limit_nonmember",
          title: "图片搜索上限：普通用户",
          disable_preview: 0,
          text: "普通用户每日搜图上限为5张，请明天再试。",
          buttons: [],
        },
        {
          key: "image_limit_member",
          title: "图片搜索上限：会员",
          disable_preview: 0,
          text: "谢谢您的支持，为防止机器人被人恶意爆刷，请于明天再来尝试搜索哦～",
          buttons: [],
        },
        {
          key: "image_reply",
          title: "图片回复模版",
          disable_preview: 1,
          text: IMAGE_REPLY_DEFAULT_TEXT,
          buttons: IMAGE_REPLY_DEFAULT_BUTTONS,
        },
      ];
      for (const tpl of defaultTemplates) {
        await db.prepare(
          `INSERT OR IGNORE INTO templates(key,title,parse_mode,disable_preview,text,buttons_json,updated_at)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(
          tpl.key,
          tpl.title,
          "HTML",
          tpl.disable_preview,
          tpl.text,
          JSON.stringify(tpl.buttons || []),
          t
        ).run();
      }
    })();
  }
  await schemaReady;
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

export async function setCanDm(env, userId, canDm) {
  const t = nowSec();
  await getDb(env).prepare(`UPDATE users SET can_dm=?, last_seen_at=? WHERE user_id=?`).bind(canDm ? 1 : 0, t, userId).run();
}

export async function recordVipMember(env, userId) {
  if (!Number.isFinite(userId)) return;
  const t = nowSec();
  await getDb(env).prepare(
    `INSERT INTO vip_members(user_id, first_seen_at, last_seen_at)
     VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`
  ).bind(userId, t, t).run();
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
