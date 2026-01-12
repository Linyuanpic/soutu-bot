export async function tgCall(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(`Telegram API ${method} failed: ${res.status} ${JSON.stringify(json)}`);
    err.status = res.status;
    err.tg = json;
    throw err;
  }
  return json.result;
}
