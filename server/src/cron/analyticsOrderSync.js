import cron from 'node-cron';
import { syncRange, syncTrailingDays, ensureBackfilled } from '../services/analyticsOrders.js';
import { centralToday } from '../services/rocketrez.js';
import { syncCrewLineToProtect } from '../services/protectPos.js';
import { ensureAutomation, runTracked } from '../services/automations.js';

/**
 * Tiered sync for the analytics dashboard's order history.
 *
 * RocketRez allows line items to be appended to an existing order on a
 * later date, without reliably exposing when that happened (no per-item
 * timestamp, `modifiedDate` isn't dependable either). A single sync
 * frequency can't be both cheap and instantly correct for edits to old
 * orders, so this runs three tiers of decreasing frequency/window:
 *
 *   1. Every 5 min     — just today, so new sales show up quickly.
 *   2. Every 15 min    — trailing 7 days, to catch line items appended to
 *                        recent orders within a bounded delay.
 *   3. Nightly (5 AM)  — trailing 30 days, catching stragglers beyond that.
 *
 * A known residual gap: an edit to an order older than 7 days won't show
 * up until the next nightly sync. Instant accuracy for arbitrarily old
 * edits would need RocketRez's "Ticket Usage" report endpoint (not yet
 * available under our API scope) — a fast-follow, not solved here.
 */
const RECENT_WINDOW_DAYS  = 7;
const NIGHTLY_LOOKBACK_DAYS = 30;

let todayJobRunning = false;
let recentJobRunning = false;

export function startAnalyticsOrderSyncCron() {
  ensureAutomation('analytics-sync-today', {
    name: 'Analytics Sync — Today', category: 'sync',
    description: "Pulls today's RocketRez orders into the analytics tables so the dashboard shows new sales quickly.",
    scheduleDescription: 'Every 5 minutes', expectedIntervalMinutes: 5,
  }).catch(() => {});
  ensureAutomation('analytics-sync-recent', {
    name: 'Analytics Sync — Recent (7-day)', category: 'sync',
    description: 'Re-pulls the trailing 7 days to catch line items RocketRez appended to recent orders after the fact.',
    scheduleDescription: 'Every 15 minutes', expectedIntervalMinutes: 15,
  }).catch(() => {});
  ensureAutomation('analytics-sync-nightly', {
    name: 'Analytics Sync — Nightly (30-day)', category: 'sync',
    description: 'Re-pulls the trailing 30 days, catching order corrections older than the 7-day reconciliation window.',
    scheduleDescription: 'Daily at 5:20 AM Central', expectedIntervalMinutes: 24 * 60,
  }).catch(() => {});
  ensureAutomation('protect-pos-crewline', {
    name: 'Protect POS — Crew Line', category: 'integration',
    description: 'Posts BB Crew Kitchen orders to UniFi Protect as POS events, overlaid on the Crew Line camera\'s footage.',
    scheduleDescription: 'Piggybacked on the 5-minute Analytics Sync — Today tier', expectedIntervalMinutes: 5,
  }).catch(() => {});

  // Every 5 minutes: today only
  cron.schedule('*/5 * * * *', async () => {
    if (todayJobRunning) return; // don't stack if a prior run is still going
    todayJobRunning = true;
    try {
      const today = centralToday();
      await runTracked('analytics-sync-today', async () => {
        const written = await syncRange(today, today, 'today');
        return `${written} orders synced`;
      });
      // Piggybacks on this tier: Crew Line POS-camera overlay needs orders
      // as fresh as they land, and this is the tightest cycle we already run.
      await runTracked('protect-pos-crewline', syncCrewLineToProtect)
        .catch(e => console.error('Protect POS sync failed:', e.message));
    } catch (e) {
      console.error('Analytics today sync failed:', e.message);
    } finally {
      todayJobRunning = false;
    }
  }, { timezone: 'America/Chicago' });

  // Every 15 minutes: trailing 7-day reconciliation
  cron.schedule('*/15 * * * *', async () => {
    if (recentJobRunning) return;
    recentJobRunning = true;
    try {
      await runTracked('analytics-sync-recent', async () => {
        const written = await syncTrailingDays(RECENT_WINDOW_DAYS, 'recent');
        return `${written} orders synced`;
      });
    } catch (e) {
      console.error('Analytics recent-window sync failed:', e.message);
    } finally {
      recentJobRunning = false;
    }
  }, { timezone: 'America/Chicago' });

  // Nightly at 5:20 AM Central — offset from crew order sync's 5:00 AM run
  // (crewOrderSync.js) so the two heaviest jobs don't both start a 30-day
  // paginated pull in the same instant. They also share a request gate
  // (rocketrez.js withRRGate) that queues either job if they do overlap.
  cron.schedule('20 5 * * *', () => {
    runTracked('analytics-sync-nightly', async () => {
      const written = await syncTrailingDays(NIGHTLY_LOOKBACK_DAYS, 'nightly');
      return `${written} orders synced`;
    }).catch(e => console.error('Analytics nightly sync failed:', e.message));
  }, { timezone: 'America/Chicago' });

  // One minute after boot: backfill history if the table is empty
  setTimeout(() => {
    ensureBackfilled().catch(e => console.error('Analytics order backfill failed:', e.message));
  }, 60_000);

  console.log('Analytics order sync cron scheduled (5-min today, 15-min/7-day, nightly/30-day, Crew Line POS overlay on the 5-min tier)');
}
