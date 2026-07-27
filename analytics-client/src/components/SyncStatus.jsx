import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { relativeTime } from '../lib/format.js';

// This dashboard reads from a polled copy of RocketRez order data, not a
// live feed — see analyticsOrderSync.js for the sync tiers. This indicator
// keeps that visible instead of implying real-time data.
export default function SyncStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.get('/analytics/sync-status').then(r => { if (!cancelled) setStatus(r.data); }).catch(() => {});
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status?.lastSync) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-az" />
      Data as of {relativeTime(status.lastSync.ranAt)}
    </div>
  );
}
