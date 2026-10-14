import cron from 'node-cron';
import {
  isConfigured, ensureBackfilled, runWaiverSync, runCheckinSync, syncTemplates, latestAllowedEnd,
} from '../services/smartwaiver.js';
import { ensureAutomation, runTracked } from '../services/automations.js';

/**
 * Keeps the `smartwaiver` schema in step with Smartwaiver.
 *
 *   boot            — resumable month-by-month backfill from BACKFILL_START
 *                     (2025-11-15) through the end of last month, then
 *                     templates. Skips months already recorded.
 *   every 15 min    — re-pulls the trailing 26 hours of waivers + check-ins.
 *                     The API refuses windows touching the current hour, so
 *                     new waivers land with up to an hour's delay. Upserts
 *                     are idempotent, so overlap is harmless.
 *   nightly 4:40 AM — re-pulls the trailing 8 days (catches edits, expiry
 *                     and verification changes) and refreshes templates.
 */
const RECENT_HOURS = 26;
const NIGHTLY_DAYS = 8;

let recentRunning = false;
let nightlyRunning = false;
const log = msg => console.log(`smartwaiver: ${msg}`);

export function startSmartwaiverSyncCron() {
  if (!isConfigured()) {
    console.log('smartwaiver: SMARTWAIVER_API_KEY not set, sync disabled');
    return;
  }
  ensureAutomation('smartwaiver-sync-recent', {
    name: 'Smartwaiver Sync — Recent', category: 'sync',
    description: 'Mirrors the trailing 26 hours of signed waivers and check-ins from Smartwaiver into the smartwaiver schema.',
    scheduleDescription: 'Every 15 minutes', expectedIntervalMinutes: 15,
  }).catch(() => {});
  ensureAutomation('smartwaiver-sync-nightly', {
    name: 'Smartwaiver Sync — Nightly (8-day)', category: 'sync',
    description: 'Re-pulls the trailing 8 days of waivers and check-ins to catch expiry/verification changes, and refreshes waiver templates.',
    scheduleDescription: 'Daily at 4:40 AM Central', expectedIntervalMinutes: 24 * 60,
  }).catch(() => {});
  ensureAutomation('smartwaiver-backfill', {
    name: 'Smartwaiver Backfill', category: 'sync',
    description: 'One-time, resumable month-by-month copy of all waivers and check-ins since Nov 15, 2025. Runs at boot and skips months already done.',
    scheduleDescription: 'At server start', expectedIntervalMinutes: null,
  }).catch(() => {});

  // Boot: backfill in the background, then templates.
  setTimeout(() => {
    runTracked('smartwaiver-backfill', async () => {
      const r = await ensureBackfilled({ log });
      if (r.skipped) return 'skipped';
      const t = await syncTemplates();
      return r.months ? `${r.months} months: ${r.waivers} waivers, ${r.checkins} check-ins; ${t} templates` : `up to date; ${t} templates`;
    }).catch(e => console.error('smartwaiver backfill failed:', e.message));
  }, 15000);

  cron.schedule('*/15 * * * *', async () => {
    if (recentRunning) return;
    recentRunning = true;
    try {
      await runTracked('smartwaiver-sync-recent', async () => {
        const end = latestAllowedEnd();
        const start = new Date(end.getTime() - RECENT_HOURS * 3600000);
        const w = await runWaiverSync('recent-waivers', start, end, { log });
        const c = await runCheckinSync('recent-checkins', start, end, { log });
        return `${w.written} waivers, ${c} check-ins${w.skipped ? `, ${w.skipped} unreadable skipped` : ''}`;
      });
    } catch (e) {
      console.error('smartwaiver recent sync failed:', e.message);
    } finally {
      recentRunning = false;
    }
  }, { timezone: 'America/Chicago' });

  cron.schedule('40 4 * * *', async () => {
    if (nightlyRunning) return;
    nightlyRunning = true;
    try {
      await runTracked('smartwaiver-sync-nightly', async () => {
        const end = latestAllowedEnd();
        const start = new Date(end.getTime() - NIGHTLY_DAYS * 86400000);
        const w = await runWaiverSync('nightly-waivers', start, end, { log });
        const c = await runCheckinSync('nightly-checkins', start, end, { log });
        const t = await syncTemplates();
        return `${w.written} waivers, ${c} check-ins, ${t} templates`;
      });
    } catch (e) {
      console.error('smartwaiver nightly sync failed:', e.message);
    } finally {
      nightlyRunning = false;
    }
  }, { timezone: 'America/Chicago' });
}
