import cron from 'node-cron';
import { syncTrailingDays, ensureBackfilled } from '../services/crewOrders.js';
import { ensureAutomation, runTracked } from '../services/automations.js';

// Nightly reconciliation of the crew-order history table. Live requests
// write through as they happen; this pass re-pulls a trailing window every
// morning so voids, refunds, and corrections made after the fact are
// reflected in stored history.
const NIGHTLY_LOOKBACK_DAYS = 30;

export function startCrewOrderSyncCron() {
  ensureAutomation('crew-order-sync', {
    name: 'Crew Order Sync', category: 'sync',
    description: 'Re-pulls the trailing 30 days of RocketRez crew orders so voids, refunds, and corrections made after the fact are reflected.',
    scheduleDescription: 'Daily at 5:00 AM Central', expectedIntervalMinutes: 24 * 60,
  }).catch(() => {});

  // 5:00 AM Central — parks are closed, RocketRez is quiet. Analytics' own
  // nightly sync (analyticsOrderSync.js) runs at 5:20 to avoid starting a
  // second 30-day pull at the same instant; both also share a request gate
  // (rocketrez.js withRRGate) so they queue instead of racing if they ever
  // do overlap.
  cron.schedule('0 5 * * *', () => {
    runTracked('crew-order-sync', async () => {
      const written = await syncTrailingDays(NIGHTLY_LOOKBACK_DAYS, 'nightly');
      return `${written} orders synced`;
    }).catch(e => console.error('Nightly crew order sync failed:', e.message));
  }, { timezone: 'America/Chicago' });

  // One minute after boot: backfill history if the table is empty
  setTimeout(() => {
    ensureBackfilled().catch(e => console.error('Crew order backfill failed:', e.message));
  }, 60_000);

  console.log('Crew order sync cron scheduled (5:00 AM Central, 30-day lookback)');
}
