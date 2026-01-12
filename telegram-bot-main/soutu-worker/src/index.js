import { JSON_HEADERS, IMAGE_PROXY_PREFIX } from "./config.js";
import { handleAdminApi } from "./admin/index.js";
import { handleWebhook } from "./bot/index.js";
import { handleImageProxyRequest } from "./search/index.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/bot/webhook" && req.method === "POST") {
      const raw = await req.text();
      let update;
      try {
        update = JSON.parse(raw);
      } catch {
        return new Response("bad json", { status: 400 });
      }
      ctx.waitUntil(handleWebhook(env, update, req.url));
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }

    if (path.startsWith(IMAGE_PROXY_PREFIX) && req.method === "GET") {
      return handleImageProxyRequest(env, req, url);
    }

    if (path.startsWith("/admin/")) {
      return handleAdminApi(env, req, path);
    }

    return new Response("Not Found", { status: 404 });
  },
};
