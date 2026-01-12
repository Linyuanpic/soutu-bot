-- Users who have ever DM'd the bot (for broadcasts)
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  can_dm INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT
);

-- VIP members observed in managed chats
CREATE TABLE IF NOT EXISTS vip_members (
  user_id INTEGER PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Managed chats (used to determine VIP membership)
CREATE TABLE IF NOT EXISTS managed_chats (
  chat_id INTEGER PRIMARY KEY,
  chat_type TEXT NOT NULL CHECK(chat_type IN ('group','channel')),
  title TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Message templates (HTML parse mode by default)
-- buttons_json is a 2D array of rows: [[{text,type,url,data}], ...]
CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  title TEXT,
  parse_mode TEXT NOT NULL DEFAULT 'HTML',
  disable_preview INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  buttons_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- Broadcast jobs (manual)
CREATE TABLE IF NOT EXISTS broadcast_jobs (
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
);

CREATE TABLE IF NOT EXISTS broadcast_logs (
  job_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','fail')),
  error_code INTEGER,
  error_msg TEXT,
  sent_at INTEGER NOT NULL
);

-- Image host configuration
CREATE TABLE IF NOT EXISTS image_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url TEXT NOT NULL UNIQUE,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  is_faulty INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Simple settings store
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
