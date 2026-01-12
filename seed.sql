-- START template: You can edit text & buy buttons in admin. Verify/Support buttons are appended by code.
INSERT OR IGNORE INTO templates (key,title,parse_mode,disable_preview,text,buttons_json,updated_at) VALUES
('start','/start 首页','HTML',0,
'为了服务能够长期稳定：\n\n普通用户：每日3次免费搜图\n\n会员用户：每日不限次免费搜图\n\n加入下方任一群组，都可获得永久不限次使用机器人哦～',
'[
  [
    {"text":"🎉会员赞助 → 188元🔥永久","type":"url","url":"https://t.me/orzboy_bot?start=bUPHj9WUw0fmYEP"}
  ],
  [
    {"text":"🎉资源合集 → 128元🔥永久","type":"url","url":"https://t.me/orzboy_bot?start=kY7cFpjD0fjsEO0"}
  ],
  [
    {"text":"🎉查找出处 → 38元🔥永久","type":"url","url":"https://t.me/orzboy_bot?start=A9G93w5qiYAspSW"}
  ]
]',
strftime('%s','now')),

('ask_code','验证卡密：提示','HTML',0,'请发送卡密：','[]',strftime('%s','now')),

('vip_new','会员验证成功','HTML',0,'您已成为尊贵的vip用户，可点击下方按钮加入打赏群！','[]',strftime('%s','now')),

('vip_renew','会员续费成功','HTML',0,'您的会员时长已叠加！可点击下方按钮尽情享用会员内容哦～','[]',strftime('%s','now')),

('support_open','人工客服：提示','HTML',0,'已开启人工客服，请发送您的消息。\n\n注：客服非24小时，看到会及时回复。','[]',strftime('%s','now')),

('support_closed','人工客服：关闭提示','HTML',0,'客服通道已关闭！','[]',strftime('%s','now')),

('support_closed_spam','人工客服：刷屏关闭','HTML',0,'消息发送失败，请于1小时后再来尝试。','[]',strftime('%s','now')),

('image_limit_nonmember','图片搜索上限：普通用户','HTML',0,'为了能长期运营下去，普通用户每日搜图上限为5张，想要尽情搜索，就请加入打赏群哦～',
'[
  [{"text":"加入打赏群","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('image_limit_member','图片搜索上限：会员','HTML',0,'谢谢您的支持，为防止机器人被人恶意爆刷，请于明天再来尝试搜索哦～','[]',strftime('%s','now')),

('exp_before_30d','到期前30天提醒','HTML',0,'您的会员身份将于 {{expire_at}} 失效（剩余 {{days_left}} 天）。如需续订，请购买卡密续费。',
'[
  [{"text":"点击续费","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_before_15d','到期前15天提醒','HTML',0,'您的会员身份将于 {{expire_at}} 失效（剩余 {{days_left}} 天）。如需续订，请购买卡密续费。',
'[
  [{"text":"点击续费","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_before_7d','到期前7天提醒','HTML',0,'您的会员身份将于 {{expire_at}} 失效（剩余 {{days_left}} 天）。如需续订，请购买卡密续费。',
'[
  [{"text":"点击续费","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_before_3d','到期前3天提醒','HTML',0,'您的会员身份将于 {{expire_at}} 失效（剩余 {{days_left}} 天）。如需续订，请购买卡密续费。',
'[
  [{"text":"点击续费","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_before_1d','到期前1天提醒','HTML',0,'您的会员身份将于 {{expire_at}} 失效（剩余 {{days_left}} 天）。如需续订，请购买卡密续费。',
'[
  [{"text":"点击续费","type":"callback","data":"/start"}]
]',
strftime('%s','now')),
  
('exp_after_1d','到期后1天提醒','HTML',0,'您的会员身份已于 {{expire_at}} 失效。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_after_3d','到期后3天提醒','HTML',0,'您的会员身份已于 {{expire_at}} 失效。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_after_7d','到期后7天提醒','HTML',0,'您的会员身份已于 {{expire_at}} 失效。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_after_15d','到期后15天提醒','HTML',0,'您的会员身份已于 {{expire_at}} 失效。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
strftime('%s','now')),

('exp_after_30d','到期后30天提醒','HTML',0,'您的会员身份已于 {{expire_at}} 失效。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
strftime('%s','now')),
  
('nonmember_monthly','会员到期提醒','HTML',0,'您的会员已到期，已被移出打赏群。如需继续使用，请购买卡密并完成验证。',
'[
  [{"text":"购买卡密","type":"callback","data":"/start"}]
]',
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

-- Settings
INSERT OR IGNORE INTO settings (key,value,updated_at) VALUES
('image_reply_template','自助搜图，具体内容点击下方按钮～',strftime('%s','now'));

-- Auto rules (enable what you want in admin)
INSERT OR IGNORE INTO auto_rules(rule_key,kind,offset_days,template_key,is_enabled) VALUES
('before_30','exp_before',30,'exp_before_30d',1),
('before_15','exp_before',15,'exp_before_15d',1),
('before_7','exp_before',7,'exp_before_7d',1),
('before_3','exp_before',3,'exp_before_3d',1),
('before_1','exp_before',1,'exp_before_1d',1),
('after_1','exp_after',1,'exp_after_1d',1),
('after_3','exp_after',3,'exp_after_3d',1),
('after_7','exp_after',7,'exp_after_7d',1),
('after_15','exp_after',15,'exp_after_15d',1),
('after_30','exp_after',30,'exp_after_30d',1),
('expire_today','nonmember_monthly',0,'nonmember_monthly',1);
