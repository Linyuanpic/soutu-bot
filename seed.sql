-- Basic templates
INSERT OR IGNORE INTO templates (key,title,parse_mode,disable_preview,text,buttons_json,updated_at) VALUES
('start','/start 首页','HTML',0,
'/start 指令自动回复首页内容\n加入下方任意一个群组，都可免费无限次使用搜图机器人哦～',
'[
  [{"text":"会员赞助","type":"url","url":"https://t.me/orzboy_bot?start=bUPHj9WUw0fmYEP"}],
  [{"text":"资源合集","type":"url","url":"https://t.me/orzboy_bot?start=kY7cFpjD0fjsEO0"}],
  [{"text":"查找出处","type":"url","url":"https://t.me/orzboy_bot?start=A9G93w5qiYAspSW"}]
]',
strftime('%s','now')),

('image_limit_nonmember','图片搜索上限：普通用户','HTML',0,
'普通用户每日搜图上限为5张，请明天再试。',
'[]',
strftime('%s','now')),

('image_limit_member','图片搜索上限：会员','HTML',0,
'谢谢您的支持，为防止机器人被人恶意爆刷，请于明天再来尝试搜索哦～',
'[]',
strftime('%s','now')),

('image_reply','图片回复模版','HTML',1,'自助搜图，具体内容点击下方按钮～',
'[
  [{"text":"GoogleLens → 看看这是谁","type":"url","url":"{{google_lens}}"}],
  [{"text":"Yandex.ru → 想找图片来源","type":"url","url":"{{yandex}}"}]
]',
strftime('%s','now'));

-- Image hosts
INSERT OR IGNORE INTO image_hosts (base_url,is_enabled,fail_count,is_faulty,created_at) VALUES
('https://catbox.moe',1,0,0,strftime('%s','now')),
('https://litterbox.catbox.moe',1,0,0,strftime('%s','now')),
('https://0x0.st',1,0,0,strftime('%s','now'));
