export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const IMAGE_PROXY_PREFIX = "/search/proxy";
export const IMAGE_PROXY_TTL_SEC = 15 * 60;
export const IMAGE_PROXY_CACHE_TTL_SEC = 60 * 10;
export const IMAGE_PROXY_RATE_WINDOW = 60;
export const IMAGE_PROXY_RATE_LIMIT = 30;

export const GROUP_DAILY_LIMIT = 3;
export const PRIVATE_DAILY_LIMIT = 300;
export const FILE_PATH_CACHE_TTL = 60 * 60 * 6;

export const TEMPLATE_TYPES = {
  SEARCH_REPLY: "search_reply",
  AUTO_REPLY: "auto_reply",
};

export const TEMPLATE_KEYS = {
  GROUP_LIMIT: "group_limit",
  PRIVATE_NON_MEMBER: "private_non_member",
  PRIVATE_LIMIT: "private_limit",
  SEARCH_DEFAULT: "search_default",
};

export const DEFAULT_SEARCH_TEXT = "搜图结果如下，请点击按钮查看：";
export const DEFAULT_SEARCH_BUTTONS = [
  [{ text: "GoogleLens → 看看这是谁", type: "url", url: "{{google_lens}}" }],
  [{ text: "Yandex.ru → 想找图片来源", type: "url", url: "{{yandex}}" }],
];
