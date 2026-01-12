import { nowSec } from "../utils.js";

function hasKvBinding(env) {
  return Boolean(env?.KV && typeof env.KV.get === "function" && typeof env.KV.put === "function");
}

async function kvGetFromD1(env, key) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare(
    "SELECT value, expires_at FROM kv_store WHERE key = ?"
  ).bind(key).first();
  if (!row) return null;
  const expiresAt = row.expires_at ? Number(row.expires_at) : null;
  if (expiresAt && expiresAt <= nowSec()) {
    await env.DB.prepare("DELETE FROM kv_store WHERE key = ?").bind(key).run();
    return null;
  }
  return row.value ?? null;
}

async function kvPutToD1(env, key, value, expirationTtl) {
  if (!env?.DB) return;
  const expiresAt = expirationTtl ? nowSec() + Number(expirationTtl) : null;
  await env.DB.prepare(
    "INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
  ).bind(key, String(value ?? ""), expiresAt).run();
}

export async function kvGet(env, key) {
  if (hasKvBinding(env)) return env.KV.get(key);
  return kvGetFromD1(env, key);
}

export async function kvPut(env, key, value, options = {}) {
  const expirationTtl = options?.expirationTtl;
  if (hasKvBinding(env)) {
    return env.KV.put(key, String(value ?? ""), { expirationTtl });
  }
  return kvPutToD1(env, key, value, expirationTtl);
}
