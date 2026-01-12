INSERT OR IGNORE INTO templates(key, type, content, buttons, is_enabled, updated_at) VALUES
  ('search_default', 'search_reply', '搜图结果自行点击下方按钮～', '[[{"text":"GoogleLens → 看看这是谁","type":"url","url":"{{google_lens}}"}], [{"text":"Yandex.ru → 想找图片来源","type":"url","url":"{{yandex}}"}]]', 1, strftime('%s','now')),
  ('group_limit', 'auto_reply', '今日群内搜图次数已用完，请明天再试。', '[]', 1, strftime('%s','now')),
  ('private_non_member', 'auto_reply', '私聊仅限会员使用，请先加入会员群。', '[]', 1, strftime('%s','now')),
  ('private_limit', 'auto_reply', '今日私聊搜图次数已用完，请明天再试。', '[]', 1, strftime('%s','now'));
