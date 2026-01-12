import { JSON_HEADERS, IMAGE_PROXY_PREFIX } from "./config.js";
import { adminHtml, consumeAdminLoginToken, createAdminSession, handleAdminApi, isAdminSession, loginHtml } from "./admin/index.js";
import { handleWebhook } from "./bot/index.js";
import { handleImageProxyRequest } from "./search/index.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const normalizedPath = path === "/bot/webhook/admin" ? "/admin" : path;

    if (normalizedPath === "/bot/webhook" && req.method === "POST") {
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

    if (normalizedPath.startsWith(IMAGE_PROXY_PREFIX) && req.method === "GET") {
      return handleImageProxyRequest(env, req, url);
    }

    if (normalizedPath === "/admin" || normalizedPath === "/") {
      const token = url.searchParams.get("token");
      if (token) {
        const userId = await consumeAdminLoginToken(env, token);
        if (userId) {
          const sessionToken = await createAdminSession(env, userId);
          return new Response("", {
            status: 302,
            headers: {
              Location: "/admin#dashboard",
              "set-cookie": `admin_session=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${7 * 24 * 3600}`,
            },
          });
        }
      }
      const userId = await isAdminSession(env, req);
      if (userId) {
        return new Response(adminHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response(loginHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (normalizedPath.startsWith("/api/admin/")) {
      return handleAdminApi(env, req, normalizedPath);
    }

    return new Response("Not Found", { status: 404 });
  },
};
