/**
 * Registry + execution history for server-side automations (cron jobs,
 * background syncs, third-party integrations we push data to) — backs the
 * Automations tab in the admin console.
 *
 * Two kinds of rows in `automations`:
 * - source='managed': defined in code via ensureAutomation() below, called
 *   once at boot by each cron file. Every boot re-asserts name/description/
 *   category/schedule/expected interval (code is the source of truth for
 *   those), but never touches `notes` or `is_active` — those are the
 *   operator's own annotations and survive deploys/restarts.
 * - source='manual': created directly from the admin UI for things that
 *   live outside this codebase entirely (a system crontab entry on the
 *   droplet, an external script) — pure documentation, no run history.
 */
import pool from '../db/index.js';

// Awaited by every exported function below — ensureAutomation() is called
// synchronously at boot by each cron file, often before this migration has
// actually finished running, so callers must wait on it rather than assume
// the tables already exist.
const migrationReady = pool.query(`CREATE TABLE IF NOT EXISTS automations (
  key                        TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  description                TEXT,
  category                   TEXT NOT NULL DEFAULT 'other',
  schedule_description       TEXT,
  expected_interval_minutes  INTEGER,
  source                     TEXT NOT NULL DEFAULT 'managed',
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`)
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS automation_runs (
    id             BIGSERIAL PRIMARY KEY,
    automation_key TEXT NOT NULL REFERENCES automations(key) ON DELETE CASCADE,
    status         TEXT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ NOT NULL,
    duration_ms    INTEGER NOT NULL,
    summary        TEXT,
    error          TEXT
  )`))
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_automation_runs_key_time ON automation_runs (automation_key, started_at DESC)'))
  .catch(e => { console.error('automations migration:', e.message); throw e; });

// Called once at boot per managed job. Upserts the definition; deliberately
// excludes notes/is_active from the UPDATE so operator edits aren't clobbered
// by the next deploy.
export async function ensureAutomation(key, def) {
  await migrationReady;
  await pool.query(
    `INSERT INTO automations (key, name, description, category, schedule_description, expected_interval_minutes, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'managed')
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
       schedule_description = EXCLUDED.schedule_description,
       expected_interval_minutes = EXCLUDED.expected_interval_minutes,
       source = 'managed', updated_at = NOW()`,
    [key, def.name, def.description || null, def.category || 'other', def.scheduleDescription || null, def.expectedIntervalMinutes || null]
  );
}

// Wraps a job body: times it, records the outcome, rethrows so existing
// per-cron-file error logging/guards keep working unchanged.
//
// `fn`'s return value becomes the run's summary AND the value runTracked
// resolves to — a plain string is used as-is; anything else is stringified.
// When a caller needs both a real return value (not just a display string —
// e.g. runCallbackDigestNow's existing numeric contract) and a nicer
// summary, return `{ result, summary }` and both are honored separately.
export async function runTracked(key, fn) {
  const startedAt = new Date();
  const t0 = Date.now();
  try {
    const raw = await fn();
    let result = raw, summary = null;
    if (raw && typeof raw === 'object' && 'result' in raw && 'summary' in raw) {
      result = raw.result;
      summary = raw.summary;
    } else if (typeof raw === 'string') {
      summary = raw;
    } else if (raw != null) {
      summary = String(raw);
    }
    await recordRun(key, 'success', startedAt, Date.now() - t0, summary, null);
    return result;
  } catch (e) {
    await recordRun(key, 'error', startedAt, Date.now() - t0, null, e.message || String(e));
    throw e;
  }
}

async function recordRun(key, status, startedAt, durationMs, summary, error) {
  try {
    await migrationReady;
    await pool.query(
      `INSERT INTO automation_runs (automation_key, status, started_at, finished_at, duration_ms, summary, error)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
      [key, status, startedAt, durationMs, summary, error]
    );
  } catch (e) {
    // Don't let a logging failure mask the real job outcome above.
    console.error(`automation_runs insert failed for ${key}:`, e.message);
  }
}
