import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { number, relativeTime } from '../lib/format.js';
import { LoadingBlock } from '../components/LoadingOverlay.jsx';

function StatusPill({ report }) {
  const expired = report.expires_at && new Date(report.expires_at) < new Date();
  const base = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold';
  if (report.revoked) return <span className={`${base} bg-gray-100 text-gray-500`}>Revoked</span>;
  if (expired) return <span className={`${base} bg-gray-100 text-gray-500`}>Expired</span>;
  return <span className={`${base} bg-emerald-50 text-emerald-700`}>Live</span>;
}

export default function SharedReports() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [busyToken, setBusyToken] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/analytics/shared-reports');
      setReports(data);
    } catch {
      setError('Failed to load shared reports.');
    }
  }

  useEffect(() => { load(); }, []);

  async function copyLink(r) {
    try {
      await navigator.clipboard.writeText(r.url);
      setCopiedToken(r.token);
      setTimeout(() => setCopiedToken(''), 1500);
    } catch {
      window.prompt('Copy this link:', r.url);
    }
  }

  async function toggleRevoke(r) {
    setBusyToken(r.token);
    try {
      await api.patch(`/analytics/shared-reports/${r.token}/revoke`, { revoked: !r.revoked });
      await load();
    } catch {
      setError('Failed to update that report.');
    } finally {
      setBusyToken('');
    }
  }

  async function setPin(r, clear = false) {
    let pin = null;
    if (!clear) {
      pin = window.prompt(`${r.has_pin ? 'New' : 'Set a'} PIN for "${r.title}" (4–8 digits). Viewers will need it before the report loads.`);
      if (pin === null) return;
      pin = pin.trim();
      if (!/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits.'); return; }
    } else if (!window.confirm(`Remove the PIN from "${r.title}"? Anyone with the link will be able to open it again.`)) {
      return;
    }
    setBusyToken(r.token);
    try {
      await api.patch(`/analytics/shared-reports/${r.token}/pin`, { pin });
      setError('');
      await load();
    } catch {
      setError('Failed to update the PIN.');
    } finally {
      setBusyToken('');
    }
  }

  async function remove(r) {
    if (!window.confirm(`Permanently delete "${r.title}"? The link will stop working immediately.`)) return;
    setBusyToken(r.token);
    try {
      await api.delete(`/analytics/shared-reports/${r.token}`);
      await load();
    } catch {
      setError('Failed to delete that report.');
    } finally {
      setBusyToken('');
    }
  }

  if (!reports) return <LoadingBlock />;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Shared Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reports built and published here — ask Claude to make one, and it'll show up in this list with a
          public link. Anyone with the link can view it, no staff login needed. Revoke or delete a link any time.
        </p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {reports.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No shared reports yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-3">Report</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.token} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.title}</p>
                    <p className="text-[11px] text-gray-400">{r.created_by || 'unknown'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill report={r} />
                    {r.has_pin && <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">PIN</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{relativeTime(r.created_at)}</td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums">
                    {number(r.view_count)}
                    {r.last_viewed_at && <span className="text-[11px] text-gray-400"> &middot; last {relativeTime(r.last_viewed_at)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => copyLink(r)}
                      className="text-xs font-medium text-az hover:text-az-dark"
                    >
                      {copiedToken === r.token ? 'Copied!' : 'Copy link'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      disabled={busyToken === r.token}
                      onClick={() => setPin(r)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40"
                    >
                      {r.has_pin ? 'Change PIN' : 'Set PIN'}
                    </button>
                    {r.has_pin && (
                      <button
                        disabled={busyToken === r.token}
                        onClick={() => setPin(r, true)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40"
                      >
                        Remove PIN
                      </button>
                    )}
                    <button
                      disabled={busyToken === r.token}
                      onClick={() => toggleRevoke(r)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40"
                    >
                      {r.revoked ? 'Restore' : 'Revoke'}
                    </button>
                    <button
                      disabled={busyToken === r.token}
                      onClick={() => remove(r)}
                      className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
