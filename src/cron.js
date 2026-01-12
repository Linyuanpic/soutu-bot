import { ensureSchema, getDb, validateEnv } from "./db.js";
import { sendTemplate } from "./telegram.js";
import { nowSec } from "./utils.js";

async function processBroadcastJobs(env) {
  const BATCH_SIZE = 50;
  const PER_SECOND = 4;

  const job = await getDb(env)
    .prepare("SELECT * FROM broadcast_jobs WHERE status IN ('pending','sending') ORDER BY created_at ASC LIMIT 1")
    .first();
  if (!job) return;

  const t = nowSec();
  if (job.status === "pending") {
    await getDb(env)
      .prepare("UPDATE broadcast_jobs SET status='sending', started_at=? WHERE job_id=?")
      .bind(t, job.job_id)
      .run();
  }

  const rows = await getDb(env)
    .prepare(
      `SELECT u.user_id FROM users u
       WHERE u.can_dm=1
       AND NOT EXISTS (
         SELECT 1 FROM broadcast_logs bl
         WHERE bl.job_id = ? AND bl.user_id = u.user_id
       )
       ORDER BY u.user_id ASC
       LIMIT ?`
    )
    .bind(job.job_id, BATCH_SIZE)
    .all();

  const candidates = rows.results || [];
  if (!candidates.length) {
    await getDb(env)
      .prepare("UPDATE broadcast_jobs SET status='done', finished_at=? WHERE job_id=?")
      .bind(nowSec(), job.job_id)
      .run();
    return;
  }

  let sentThisRun = 0;
  let ok = 0;
  let fail = 0;

  for (const r of candidates) {
    if (sentThisRun >= BATCH_SIZE) break;
    try {
      if (job.template_key) {
        await sendTemplate(env, r.user_id, job.template_key);
      }
      await getDb(env)
        .prepare("INSERT INTO broadcast_logs(job_id,user_id,status,sent_at) VALUES (?,?,?,?)")
        .bind(job.job_id, r.user_id, "ok", nowSec())
        .run();
      ok++;
    } catch (e) {
      const code = Number(e.tg?.error_code || e.status || 0) || null;
      const msg = String(e.tg?.description || e.message || "error").slice(0, 200);
      await getDb(env)
        .prepare(
          "INSERT INTO broadcast_logs(job_id,user_id,status,error_code,error_msg,sent_at) VALUES (?,?,?,?,?,?)"
        )
        .bind(job.job_id, r.user_id, "fail", code, msg, nowSec())
        .run();
      fail++;
    }

    sentThisRun++;
    await new Promise((res) => setTimeout(res, Math.ceil(1000 / PER_SECOND)));
  }

  await getDb(env)
    .prepare("UPDATE broadcast_jobs SET ok=ok+?, fail=fail+? WHERE job_id=?")
    .bind(ok, fail, job.job_id)
    .run();
}

export async function scheduled(event, env, ctx) {
  const envIssues = validateEnv(env);
  if (envIssues.length) return;
  await ensureSchema(env);
  ctx.waitUntil(processBroadcastJobs(env));
}
