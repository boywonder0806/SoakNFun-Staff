/**
 * Smartwaiver mirror.
 *
 * Copies everything the Smartwaiver v4 API exposes about signed waivers into
 * a set of `smartwaiver_*` tables (in the app database by default, see
 * db/smartwaiver.js) so reports can be run with SQL instead of crawling the
 * API every time. These tables are standalone: nothing else in the app
 * reads or writes them.
 *
 * What's mirrored:
 *   smartwaiver.templates     — one row per waiver template
 *   smartwaiver.waivers       — one row per signed waiver (primary signer + address)
 *   smartwaiver.participants  — one row per person on a waiver
 *   smartwaiver.waiver_raw    — the full API object per waiver (minus the PDF)
 *   smartwaiver.checkins      — Smartwaiver kiosk/console check-ins
 *
 * API quirks this works around (all verified against the live account):
 *   - The list endpoint omits addresses; only the search results and the
 *     single-waiver endpoint return full objects. So windows are pulled via
 *     search (100 full waivers per page, ~5 concurrent pages).
 *   - A search is capped at 30,000 results; bigger windows are bisected.
 *   - Search creation is limited to 5/min, everything else to 100/min.
 *   - Date filters and createdOn are UTC, and both ends of a window must be
 *     before the current hour.
 *   - A handful of waivers make the API 500 on any page containing them (and
 *     on direct fetch). A failed page is recovered by bounding its time
 *     window from the neighbouring pages and fetching each waiver singly;
 *     the unreadable ones are logged in waiver_sync_errors and skipped.
 *   - Check-ins paginate with a row offset capped at 1,000, so they're pulled
 *     in hourly windows, bisected if one overflows.
 */
import { getSmartwaiverPool, swQuery } from '../db/smartwaiver.js';

const BASE = 'https://api.smartwaiver.com';
const SEARCH_CAP = 30000;
const PAGE_WORKERS = 5;
const GENERAL_GAP_MS = 60000 / 80;   // stay under 100 req/min
const SEARCH_GAP_MS = 12500;         // stay under 5 searches/min
const CHECKIN_PAGE = 100;
const CHECKIN_MAX_OFFSET = 1000;

export const BACKFILL_START = process.env.SMARTWAIVER_BACKFILL_START || '2025-11-15T00:00:00Z';

export function isConfigured() {
  return !!process.env.SMARTWAIVER_API_KEY;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const SCHEMA = [
  'CREATE SCHEMA IF NOT EXISTS smartwaiver',
  `CREATE TABLE IF NOT EXISTS smartwaiver.templates (
    template_id               TEXT PRIMARY KEY,
    title                     TEXT,
    published_on              TIMESTAMPTZ,
    published_version         BIGINT,
    web_url                   TEXT,
    kiosk_url                 TEXT,
    custom_fields             JSONB,
    participant_custom_fields JSONB,
    raw                       JSONB,
    synced_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.waivers (
    waiver_id                  TEXT PRIMARY KEY,
    template_id                TEXT,
    title                      TEXT,
    created_on                 TIMESTAMPTZ NOT NULL,
    expiration_date            TIMESTAMPTZ,
    expired                    BOOLEAN,
    verified                   BOOLEAN,
    kiosk                      BOOLEAN,
    first_name                 TEXT,
    middle_name                TEXT,
    last_name                  TEXT,
    dob                        DATE,
    is_minor                   BOOLEAN,
    auto_tag                   TEXT,
    tags                       JSONB,
    flags                      JSONB,
    email                      TEXT,
    marketing_allowed          BOOLEAN,
    marketing_allowed_checkbox BOOLEAN,
    phone_opt_in               BOOLEAN,
    address_line_one           TEXT,
    address_line_two           TEXT,
    address_city               TEXT,
    address_state              TEXT,
    address_zip                TEXT,
    address_zip5               TEXT GENERATED ALWAYS AS (substring(address_zip from '^[0-9]{5}')) STORED,
    address_country            TEXT,
    emergency_contact_name     TEXT,
    emergency_contact_relation TEXT,
    emergency_contact_phone    TEXT,
    insurance_carrier          TEXT,
    insurance_policy_number    TEXT,
    drivers_license_number     TEXT,
    drivers_license_state      TEXT,
    client_ip                  TEXT,
    photos                     INTEGER,
    external_id                TEXT,
    prefill_id                 TEXT,
    guardian                   JSONB,
    custom_waiver_fields       JSONB,
    typed_signatures           JSONB,
    participant_count          INTEGER,
    adult_count                INTEGER,
    minor_count                INTEGER,
    synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.participants (
    waiver_id      TEXT NOT NULL REFERENCES smartwaiver.waivers(waiver_id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    first_name     TEXT,
    middle_name    TEXT,
    last_name      TEXT,
    dob            DATE,
    is_minor       BOOLEAN,
    minor_expired  BOOLEAN,
    gender         TEXT,
    phone          TEXT,
    relationship   TEXT,
    tags           JSONB,
    custom_fields  JSONB,
    flags          JSONB,
    PRIMARY KEY (waiver_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.waiver_raw (
    waiver_id  TEXT PRIMARY KEY REFERENCES smartwaiver.waivers(waiver_id) ON DELETE CASCADE,
    data       JSONB NOT NULL,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.checkins (
    checkin_id     BIGINT PRIMARY KEY,
    checked_in_at  TIMESTAMPTZ NOT NULL,
    waiver_id      TEXT,
    position       INTEGER,
    first_name     TEXT,
    last_name      TEXT,
    is_minor       BOOLEAN,
    date_signed    TIMESTAMPTZ,
    template_id    TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.sync_chunks (
    kind         TEXT NOT NULL,
    range_start  TIMESTAMPTZ NOT NULL,
    range_end    TIMESTAMPTZ NOT NULL,
    row_count    INTEGER,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, range_start, range_end)
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.sync_runs (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,
    range_start TIMESTAMPTZ,
    range_end   TIMESTAMPTZ,
    row_count   INTEGER,
    status      TEXT NOT NULL,
    error       TEXT,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS smartwaiver.sync_errors (
    waiver_id  TEXT PRIMARY KEY,
    error      TEXT,
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_waivers_created_on ON smartwaiver.waivers (created_on)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_waivers_template ON smartwaiver.waivers (template_id)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_waivers_zip5 ON smartwaiver.waivers (address_zip5)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_waivers_state ON smartwaiver.waivers (address_state)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_waivers_email ON smartwaiver.waivers (lower(email))',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_participants_name ON smartwaiver.participants (lower(last_name), lower(first_name))',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_participants_dob ON smartwaiver.participants (dob)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_checkins_time ON smartwaiver.checkins (checked_in_at)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_checkins_waiver ON smartwaiver.checkins (waiver_id)',
  'CREATE INDEX IF NOT EXISTS idx_smartwaiver_sync_runs_time ON smartwaiver.sync_runs (started_at DESC)',
];

let migrationPromise = null;
export function ensureSchema() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const pool = await getSmartwaiverPool();
      for (const sql of SCHEMA) await pool.query(sql);
    })().catch(e => { migrationPromise = null; throw e; });
  }
  return migrationPromise;
}

// ---------------------------------------------------------------------------
// API client with rate limiting + retries
// ---------------------------------------------------------------------------
class Spacer {
  constructor(gapMs) { this.gapMs = gapMs; this.chain = Promise.resolve(); this.last = 0; }
  wait() {
    const p = this.chain.then(async () => {
      const due = this.last + this.gapMs - Date.now();
      if (due > 0) await sleep(due);
      this.last = Date.now();
    });
    this.chain = p.catch(() => {});
    return p;
  }
}
const generalSpacer = new Spacer(GENERAL_GAP_MS);
const searchSpacer = new Spacer(SEARCH_GAP_MS);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(status, message, url) { super(message); this.status = status; this.url = url; }
}

async function apiGet(path, params = {}, { spacer = generalSpacer, serverRetries = 2 } = {}) {
  const key = process.env.SMARTWAIVER_API_KEY;
  if (!key) throw new Error('SMARTWAIVER_API_KEY is not set');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;
  let attempt = 0;
  for (;;) {
    await spacer.wait();
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120000) });
    } catch (e) {
      if (attempt++ < 4) { await sleep(5000 * attempt); continue; }
      throw new ApiError(0, `network error: ${e.message}`, url);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 15;
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (res.status >= 500) {
      if (attempt++ < serverRetries) { await sleep(5000 * attempt); continue; }
      throw new ApiError(res.status, `HTTP ${res.status} from Smartwaiver`, url);
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg += `: ${(await res.json()).message}`; } catch { /* ignore */ }
      throw new ApiError(res.status, msg, url);
    }
    return res.json();
  }
}

// Smartwaiver wants "YYYY-MM-DDTHH:MM:SS" (UTC, no zone suffix).
const fmt = d => new Date(d).toISOString().slice(0, 19);
// API timestamps are "YYYY-MM-DD HH:MM:SS" in UTC.
const parseTs = s => (s ? new Date(`${s.replace(' ', 'T')}Z`) : null);
const parseDate = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Latest moment the API will accept as a window end: one second before the current hour. */
export function latestAllowedEnd(now = new Date()) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return new Date(d.getTime() - 1000);
}

// ---------------------------------------------------------------------------
// Row mapping + upserts
// ---------------------------------------------------------------------------
function waiverRow(w) {
  const participants = Array.isArray(w.participants) ? w.participants : [];
  return [
    w.waiverId, w.templateId, w.title, parseTs(w.createdOn), parseTs(w.expirationDate),
    w.expired ?? null, w.verified ?? null, w.kiosk ?? null,
    w.firstName, w.middleName, w.lastName, parseDate(w.dob), w.isMinor ?? null,
    w.autoTag, JSON.stringify(w.tags ?? []), JSON.stringify(w.flags ?? []),
    w.email, w.marketingAllowed ?? null, w.marketingAllowedCheckbox ?? null, w.phoneOptIn ?? null,
    w.addressLineOne, w.addressLineTwo, w.addressCity, w.addressState, w.addressZip, w.addressCountry,
    w.emergencyContactName, w.emergencyContactRelation, w.emergencyContactPhone,
    w.insuranceCarrier, w.insurancePolicyNumber, w.driversLicenseNumber, w.driversLicenseState,
    w.clientIP, Number.isFinite(w.photos) ? w.photos : null, w.externalId, w.prefillId,
    w.guardian ? JSON.stringify(w.guardian) : null,
    JSON.stringify(w.customWaiverFields ?? {}),
    w.typedSignatures ? JSON.stringify(w.typedSignatures) : null,
    participants.length,
    participants.filter(p => !p.isMinor).length,
    participants.filter(p => p.isMinor).length,
  ];
}

const WAIVER_COLS = [
  'waiver_id', 'template_id', 'title', 'created_on', 'expiration_date',
  'expired', 'verified', 'kiosk',
  'first_name', 'middle_name', 'last_name', 'dob', 'is_minor',
  'auto_tag', 'tags', 'flags',
  'email', 'marketing_allowed', 'marketing_allowed_checkbox', 'phone_opt_in',
  'address_line_one', 'address_line_two', 'address_city', 'address_state', 'address_zip', 'address_country',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
  'insurance_carrier', 'insurance_policy_number', 'drivers_license_number', 'drivers_license_state',
  'client_ip', 'photos', 'external_id', 'prefill_id',
  'guardian', 'custom_waiver_fields', 'typed_signatures',
  'participant_count', 'adult_count', 'minor_count',
];
const WAIVER_INSERT = `INSERT INTO smartwaiver.waivers (${WAIVER_COLS.join(', ')}, synced_at)
  VALUES (${WAIVER_COLS.map((_, i) => `$${i + 1}`).join(', ')}, NOW())
  ON CONFLICT (waiver_id) DO UPDATE SET ${WAIVER_COLS.filter(c => c !== 'waiver_id').map(c => `${c} = EXCLUDED.${c}`).join(', ')}, synced_at = NOW()`;

const PARTICIPANT_INSERT = `INSERT INTO smartwaiver.participants
  (waiver_id, position, first_name, middle_name, last_name, dob, is_minor, minor_expired, gender, phone, relationship, tags, custom_fields, flags)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;

/** Writes a batch of full waiver objects (from search results or single fetch). Returns the count written. */
export async function upsertWaivers(waivers) {
  if (!waivers.length) return 0;
  await ensureSchema();
  const pool = await getSmartwaiverPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const w of waivers) {
      if (!w?.waiverId) continue;
      await client.query(WAIVER_INSERT, waiverRow(w));
      await client.query('DELETE FROM smartwaiver.participants WHERE waiver_id = $1', [w.waiverId]);
      const participants = Array.isArray(w.participants) ? w.participants : [];
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        await client.query(PARTICIPANT_INSERT, [
          w.waiverId, i, p.firstName, p.middleName, p.lastName, parseDate(p.dob),
          p.isMinor ?? null, p.minorExpired ?? null, p.gender, p.phone, p.relationship ?? null,
          JSON.stringify(p.tags ?? []), JSON.stringify(p.customParticipantFields ?? {}), JSON.stringify(p.flags ?? []),
        ]);
      }
      const { pdf, ...raw } = w; // never keep the base64 PDF
      await client.query(
        `INSERT INTO smartwaiver.waiver_raw (waiver_id, data, synced_at) VALUES ($1, $2, NOW())
         ON CONFLICT (waiver_id) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()`,
        [w.waiverId, JSON.stringify(raw)]
      );
      await client.query('DELETE FROM smartwaiver.sync_errors WHERE waiver_id = $1', [w.waiverId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return waivers.length;
}

async function recordUnreadable(waiverId, error) {
  await swQuery(
    `INSERT INTO smartwaiver.sync_errors (waiver_id, error, last_seen) VALUES ($1, $2, NOW())
     ON CONFLICT (waiver_id) DO UPDATE SET error = EXCLUDED.error, last_seen = NOW()`,
    [waiverId, error]
  );
}

async function recordRun(kind, start, end, rowCount, status, error, startedAt) {
  await swQuery(
    `INSERT INTO smartwaiver.sync_runs (kind, range_start, range_end, row_count, status, error, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [kind, start, end, rowCount, status, error, startedAt]
  ).catch(e => console.error('smartwaiver sync_runs insert failed:', e.message));
}

// ---------------------------------------------------------------------------
// Waiver windows (search based)
// ---------------------------------------------------------------------------
async function createSearch(start, end) {
  const d = await apiGet('/v4/search', { fromDts: fmt(start), toDts: fmt(end) }, { spacer: searchSpacer });
  return d.search; // { guid, count, pages, pageSize }
}

async function fetchSearchPage(guid, page) {
  const d = await apiGet(`/v4/search/${guid}/results`, { page });
  return d.search_results || [];
}

async function fetchWaiver(waiverId) {
  const d = await apiGet(`/v4/waivers/${waiverId}`);
  return d.waiver;
}

/** IDs of every waiver in a window via the (address-less) list endpoint. */
async function listWaiverIds(start, end) {
  const ids = [];
  for (let offset = 0; ; offset++) {
    const d = await apiGet('/v4/waivers', { fromDts: fmt(start), toDts: fmt(end), limit: 300, offset });
    const ws = d.waivers || [];
    ids.push(...ws.map(w => w.waiverId));
    if (ws.length < 300) break;
  }
  return ids;
}

/**
 * A search page that keeps 500ing contains a waiver the API can't serialise.
 * Bad pages often come in adjacent runs, so a run [first..last] is recovered
 * as one unit: bound its time window from the nearest *readable* pages on
 * either side (results are newest first), list the IDs in that window and
 * fetch each waiver singly, skipping the ones that still fail. A neighbour
 * that also fails just widens the run.
 */
async function recoverRun(guid, first, last, pages, start, end, log) {
  let upper = end, lower = start;
  for (let p = first - 1; p >= 0; p--) {
    try { upper = parseTs((await fetchSearchPage(guid, p)).at(-1)?.createdOn) || end; break; }
    catch (e) { if (!(e instanceof ApiError && e.status >= 500)) throw e; first = p; }
  }
  for (let p = last + 1; p < pages; p++) {
    try { lower = parseTs((await fetchSearchPage(guid, p))[0]?.createdOn) || start; break; }
    catch (e) { if (!(e instanceof ApiError && e.status >= 500)) throw e; last = p; }
  }
  log(`recovering pages ${first}-${last} singly (${fmt(lower)} .. ${fmt(upper)})`);
  let written = 0, skipped = 0;
  for (const id of await listWaiverIds(lower, upper)) {
    try {
      const n = await upsertWaivers([await fetchWaiver(id)]);
      written += n;
    } catch (e) {
      if (!(e instanceof ApiError && e.status >= 500)) throw e;
      skipped++;
      log(`waiver ${id} unreadable, skipped: ${e.message}`);
      await recordUnreadable(id, e.message);
    }
  }
  return { written, skipped, last };
}

/**
 * Mirrors every waiver created in [start, end]. Splits windows that hit the
 * search cap. Returns { written, skipped }.
 */
export async function syncWaiverWindow(start, end, { log = () => {} } = {}) {
  start = new Date(start); end = new Date(end);
  const maxEnd = latestAllowedEnd();
  if (end > maxEnd) end = maxEnd;
  if (start >= end) return { written: 0, skipped: 0 };

  const search = await createSearch(start, end);
  if (search.count >= SEARCH_CAP) {
    const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    mid.setUTCMinutes(0, 0, 0);
    if (mid <= start || mid >= end) throw new Error(`window ${fmt(start)}..${fmt(end)} too dense to split`);
    log(`${fmt(start)} .. ${fmt(end)} hits the ${SEARCH_CAP} cap, splitting at ${fmt(mid)}`);
    const a = await syncWaiverWindow(start, mid, { log });
    const b = await syncWaiverWindow(new Date(mid.getTime() + 1000), end, { log });
    return { written: a.written + b.written, skipped: a.skipped + b.skipped };
  }
  log(`${fmt(start)} .. ${fmt(end)}: ${search.count} waivers, ${search.pages} pages`);
  if (!search.count) return { written: 0, skipped: 0 };

  let written = 0, skipped = 0;
  const failed = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const page = next++;
      if (page >= search.pages) return;
      try {
        // Await first, then add: `written += await ...` reads the counter
        // before the await and would clobber other workers' increments.
        const n = await upsertWaivers(await fetchSearchPage(search.guid, page));
        written += n;
      } catch (e) {
        if (e instanceof ApiError && e.status >= 500) { failed.push(page); log(`page ${page} failed: ${e.message}`); }
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_WORKERS, search.pages) }, worker));
  failed.sort((a, b) => a - b);
  for (let i = 0; i < failed.length; i++) {
    let j = i;
    while (j + 1 < failed.length && failed[j + 1] === failed[j] + 1) j++;
    const r = await recoverRun(search.guid, failed[i], failed[j], search.pages, start, end, log);
    written += r.written; skipped += r.skipped;
    while (i + 1 < failed.length && failed[i + 1] <= r.last) i++; // absorbed by a widened run
  }
  return { written, skipped };
}

/** Tracked wrapper used by cron + backfill: records a sync_runs row either way. */
export async function runWaiverSync(kind, start, end, opts) {
  const startedAt = new Date();
  try {
    const r = await syncWaiverWindow(start, end, opts);
    await recordRun(kind, start, end, r.written, 'success', r.skipped ? `${r.skipped} unreadable waivers skipped` : null, startedAt);
    return r;
  } catch (e) {
    await recordRun(kind, start, end, null, 'error', e.message, startedAt);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function syncTemplates() {
  await ensureSchema();
  const list = (await apiGet('/v4/templates')).templates || [];
  let n = 0;
  for (const t of list) {
    const full = (await apiGet(`/v4/templates/${t.templateId}`, { customFields: true })).template || t;
    await swQuery(
      `INSERT INTO smartwaiver.templates (template_id, title, published_on, published_version, web_url, kiosk_url, custom_fields, participant_custom_fields, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (template_id) DO UPDATE SET title = EXCLUDED.title, published_on = EXCLUDED.published_on,
         published_version = EXCLUDED.published_version, web_url = EXCLUDED.web_url, kiosk_url = EXCLUDED.kiosk_url,
         custom_fields = EXCLUDED.custom_fields, participant_custom_fields = EXCLUDED.participant_custom_fields,
         raw = EXCLUDED.raw, synced_at = NOW()`,
      [full.templateId, full.title, parseTs(full.publishedOn), full.publishedVersion ?? null, full.webUrl, full.kioskUrl,
       JSON.stringify(full.customFields ?? []), JSON.stringify(full.participantCustomFields ?? []), JSON.stringify(full)]
    );
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------
async function upsertCheckins(rows) {
  if (!rows.length) return 0;
  const pool = await getSmartwaiverPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of rows) {
      await client.query(
        `INSERT INTO smartwaiver.checkins (checkin_id, checked_in_at, waiver_id, position, first_name, last_name, is_minor, date_signed, template_id, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (checkin_id) DO UPDATE SET checked_in_at = EXCLUDED.checked_in_at, waiver_id = EXCLUDED.waiver_id,
           position = EXCLUDED.position, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           is_minor = EXCLUDED.is_minor, date_signed = EXCLUDED.date_signed, template_id = EXCLUDED.template_id, synced_at = NOW()`,
        [c.checkinId, parseTs(c.date), c.waiverId, c.position ?? null, c.firstName, c.lastName,
         c.isMinor == null ? null : !!Number(c.isMinor), parseTs(c.dateSigned), c.templateId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return rows.length;
}

/** One check-in window; returns row count or null if the window overflowed the offset cap. */
async function pullCheckinWindow(start, end) {
  let total = 0;
  for (let offset = 0; ; offset += CHECKIN_PAGE) {
    if (offset > CHECKIN_MAX_OFFSET) return null;
    const d = (await apiGet('/v4/checkins', { fromDts: fmt(start), toDts: fmt(end), limit: CHECKIN_PAGE, offset })).checkins;
    total += await upsertCheckins(d.checkins || []);
    if (!d.moreCheckins || !(d.checkins || []).length) return total;
  }
}

/** Mirrors check-ins in [start, end] in daily windows, bisecting any window that overflows the offset cap. */
export async function syncCheckinWindow(start, end, { log = () => {} } = {}) {
  await ensureSchema();
  start = new Date(start); end = new Date(end);
  const maxEnd = latestAllowedEnd();
  if (end > maxEnd) end = maxEnd;
  let total = 0;
  const windows = [];
  for (let t = start; t < end; ) {
    const next = new Date(Math.min(t.getTime() + 86400000, end.getTime() + 1000));
    windows.push([t, new Date(next.getTime() - 1000)]);
    t = next;
  }
  while (windows.length) {
    const [a, b] = windows.shift();
    const n = await pullCheckinWindow(a, b);
    if (n === null) {
      const mid = new Date(a.getTime() + (b.getTime() - a.getTime()) / 2);
      if (mid <= a) throw new Error(`check-in window ${fmt(a)}..${fmt(b)} too dense`);
      log(`check-ins ${fmt(a)}..${fmt(b)} overflowed, splitting`);
      windows.unshift([a, mid], [new Date(mid.getTime() + 1000), b]);
      continue;
    }
    total += n;
  }
  return total;
}

export async function runCheckinSync(kind, start, end, opts) {
  const startedAt = new Date();
  try {
    const n = await syncCheckinWindow(start, end, opts);
    await recordRun(kind, start, end, n, 'success', null, startedAt);
    return n;
  } catch (e) {
    await recordRun(kind, start, end, null, 'error', e.message, startedAt);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Backfill (resumable, month by month)
// ---------------------------------------------------------------------------
function monthChunks(from, to) {
  const chunks = [];
  let cur = new Date(from);
  while (cur < to) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const end = next < to ? new Date(next.getTime() - 1000) : to;
    chunks.push([cur, end]);
    cur = next;
  }
  return chunks;
}

let backfillRunning = false;

async function recordChunk(kind, a, b, n) {
  await swQuery('INSERT INTO smartwaiver.sync_chunks (kind, range_start, range_end, row_count) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [kind, a, b, n]);
}

/**
 * Brings the mirror up to date in two steps, both resumable via sync_chunks:
 *   1. whole months from BACKFILL_START through the end of last month that
 *      aren't recorded yet;
 *   2. a catch-up chunk from the end of the latest recorded chunk to the
 *      newest moment the API allows (covers the current month on first run,
 *      and any downtime longer than the rolling cron window after that).
 * Safe to call on every boot: finished chunks are skipped, a crash resumes.
 */
export async function ensureBackfilled({ log = console.log } = {}) {
  if (backfillRunning || !isConfigured()) return { skipped: true };
  backfillRunning = true;
  try {
    await ensureSchema();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const chunks = monthChunks(new Date(BACKFILL_START), new Date(monthStart.getTime() - 1000));
    const { rows } = await swQuery('SELECT kind, range_start, range_end FROM smartwaiver.sync_chunks');
    const done = new Set(rows.map(r => `${r.kind}|${new Date(r.range_start).toISOString()}|${new Date(r.range_end).toISOString()}`));
    let months = 0, waivers = 0, checkins = 0;
    for (const [a, b] of chunks) {
      if (!done.has(`waivers|${a.toISOString()}|${b.toISOString()}`)) {
        const r = await runWaiverSync('backfill-waivers', a, b, { log });
        await recordChunk('waivers', a, b, r.written);
        waivers += r.written; months++;
      }
      if (!done.has(`checkins|${a.toISOString()}|${b.toISOString()}`)) {
        const n = await runCheckinSync('backfill-checkins', a, b, { log });
        await recordChunk('checkins', a, b, n);
        checkins += n;
      }
    }
    // Catch-up from wherever the recorded chunks end to now.
    const end = latestAllowedEnd();
    for (const kind of ['waivers', 'checkins']) {
      const { rows: [{ last }] } = await swQuery('SELECT MAX(range_end) AS last FROM smartwaiver.sync_chunks WHERE kind = $1', [kind]);
      const start = new Date(Math.max(last ? new Date(last).getTime() + 1000 : 0, new Date(BACKFILL_START).getTime()));
      if (start >= end) continue;
      if (kind === 'waivers') {
        const r = await runWaiverSync('catchup-waivers', start, end, { log });
        await recordChunk('waivers', start, end, r.written);
        waivers += r.written;
      } else {
        const n = await runCheckinSync('catchup-checkins', start, end, { log });
        await recordChunk('checkins', start, end, n);
        checkins += n;
      }
    }
    return { months, waivers, checkins };
  } finally {
    backfillRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Status for the admin/analytics UI
// ---------------------------------------------------------------------------
export async function getStatus() {
  if (!isConfigured()) return { configured: false };
  await ensureSchema();
  const [w, c, t, runs, chunks, errs] = await Promise.all([
    swQuery('SELECT COUNT(*)::int AS n, MIN(created_on) AS oldest, MAX(created_on) AS newest, MAX(synced_at) AS last_synced FROM smartwaiver.waivers'),
    swQuery('SELECT COUNT(*)::int AS n, MAX(checked_in_at) AS newest FROM smartwaiver.checkins'),
    swQuery('SELECT COUNT(*)::int AS n FROM smartwaiver.templates'),
    swQuery('SELECT kind, range_start, range_end, row_count, status, error, started_at, finished_at FROM smartwaiver.sync_runs ORDER BY started_at DESC LIMIT 20'),
    swQuery('SELECT kind, COUNT(*)::int AS n, MIN(range_start) AS first, MAX(range_end) AS last FROM smartwaiver.sync_chunks GROUP BY kind'),
    swQuery('SELECT COUNT(*)::int AS n FROM smartwaiver.sync_errors'),
  ]);
  return {
    configured: true,
    backfillStart: BACKFILL_START,
    waivers: w.rows[0], checkins: c.rows[0], templates: t.rows[0].n,
    unreadableWaivers: errs.rows[0].n,
    backfillChunks: chunks.rows,
    recentRuns: runs.rows,
  };
}
