CREATE TABLE IF NOT EXISTS members (
  user_id INTEGER PRIMARY KEY,
  expires_at INTEGER,
  source_group TEXT,
  status TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS vip_groups (
  chat_id INTEGER PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  type TEXT,
  content TEXT,
  buttons TEXT,
  is_enabled INTEGER DEFAULT 1,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  chat_type TEXT,
  timestamp INTEGER,
  success INTEGER
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT,
  sent_at INTEGER,
  sent_count INTEGER
);

CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY,
  role TEXT
);
