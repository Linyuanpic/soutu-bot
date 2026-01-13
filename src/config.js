export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
export const DEFAULT_D1_BINDING = "DB";
export const DEFAULT_KV_BINDING = "KV";
export const TEMPLATE_SORT_ORDER = [
  "start",
  "vip_new",
  "vip_renew",
  "exp_before_30d",
  "exp_before_15d",
  "exp_before_7d",
  "exp_before_3d",
  "exp_before_1d",
  "nonmember_monthly",
  "exp_after_1d",
  "exp_after_3d",
  "exp_after_7d",
  "exp_after_15d",
  "exp_after_30d",
];
export const IMAGE_REPLY_TEMPLATE_KEY = "image_reply";
export const IMAGE_REPLY_DEFAULT_TEXT = "搜图结果自行点击下方按钮查看哦～";
export const IMAGE_REPLY_DEFAULT_BUTTONS = [
  [{ text: "GoogleLens → 看看这是谁", type: "url", url: "{{google_lens}}" }],
  [{ text: "Yandex.ru → 想找图片来源", type: "url", url: "{{yandex}}" }],
  [{ text: "情色百科 → 同人作品搜索", type: "url", url: "https://t.me/+Or5eQlGIEA1mYmM1" }]
];
export const IMAGE_PROXY_PREFIX = "/tgimg";
export const IMAGE_PROXY_TTL_SEC = 60 * 60;
export const IMAGE_PROXY_CACHE_TTL_SEC = 60 * 60;
export const IMAGE_PROXY_RATE_LIMIT = 3;
export const IMAGE_PROXY_RATE_WINDOW = 60;
export const FILE_PATH_CACHE_TTL = 7 * 24 * 3600;
export const DAILY_SEARCH_RESET_HOUR = 8;
export const DAILY_SEARCH_LIMIT_NONMEMBER = 3;
export const DAILY_SEARCH_LIMIT_MEMBER = 300;
export const GROUP_MEMBER_EXPIRE_DAYS = 36500;
export const WEEKDAY_INDEX = {
  Sun: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
