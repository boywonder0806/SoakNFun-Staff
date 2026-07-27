import cron from 'node-cron';
import { syncRange, syncTrailingDays, ensureBackfilled } from '../services/analyticsOrders.js';
import { centralToday } from '../services/rocketrez.js';

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
  // Every 5 minutes: today only
  cron.schedule('*/5 * * * *', async () => {
    if (todayJobRunning) return; // don't stack if a prior run is still going
    todayJobRunning = true;
    try {
      const today = centralToday();
      await syncRange(today, today, 'today');
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
      await syncTrailingDays(RECENT_WINDOW_DAYS, 'recent');
    } catch (e) {
      console.error('Analytics recent-window sync failed:', e.message);
    } finally {
      recentJobRunning = false;
    }
  }, { timezone: 'America/Chicago' });

  // Nightly at 5:00 AM Central — parks are closed, RocketRez is quiet
  cron.schedule('0 5 * * *', () => {
    syncTrailingDays(NIGHTLY_LOOKBACK_DAYS, 'nightly')
      .catch(e => console.error('Analytics nightly sync failed:', e.message));
  }, { timezone: 'America/Chicago' });

  // One minute after boot: backfill history if the table is empty
  setTimeout(() => {
    ensureBackfilled().catch(e => console.error('Analytics order backfill failed:', e.message));
  }, 60_000);

  console.log('Analytics order sync cron scheduled (5-min today, 15-min/7-day, nightly/30-day)');
}
