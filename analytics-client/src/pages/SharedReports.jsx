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

const fmtWhen = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const browserOf = ua => {
  if (!ua) return '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Other';
};

function PeoplePanel({ report, onError }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState('');
  const [reveal, setReveal] = useState({});
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const { data } = await api.get(`/analytics/shared-reports/${report.token}/recipients`);
      setData(data);
    } catch {
      onError('Failed to load people for that report.');
    }
  }
  useEffect(() => { load(); }, [report.token]);

  async function run(key, fn, successMsg) {
    setBusy(key);
    setNotice('');
    try {
      const msg = await fn();
      await load();
      if (successMsg || msg) setNotice(msg || successMsg);
    } catch (err) {
      onError(err?.response?.data?.error || 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }

  function add(e) {
    e.preventDefault();
    if (!email.trim()) return;
    run('add', async () => {
      const { data: res } = await api.post(`/analytics/shared-reports/${report.token}/recipients`, { email: email.trim(), name: name.trim() || undefined, sendEmail });
      setEmail(''); setName('');
      setReveal(r => ({ ...r, [res.recipient.id]: true }));
      return res.emailed
        ? `PIN ${res.recipient.pin} created and emailed to ${res.recipient.email}.`
        : `PIN ${res.recipient.pin} created for ${res.recipient.email}${sendEmail ? ' — the email could not be sent, share it manually.' : '.'}`;
    });
  }

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); setNotice(`${label} copied.`); }
    catch { window.prompt('Copy:', text); }
  };

  if (!data) return <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>;
  const { recipients, views } = data;

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-4 space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">
          <span className="block mb-1 font-semibold">Email</span>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="person@example.com"
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-60 bg-white" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1 font-semibold">Name <span className="font-normal text-gray-400">(optional)</span></span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="First Last"
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-44 bg-white" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2">
          <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} /> Email them the link and PIN
        </label>
        <button type="submit" disabled={busy === 'add'} className="bg-az text-white text-xs font-semibold rounded-lg px-3 py-2 disabled:opacity-40">
          {busy === 'add' ? 'Adding…' : 'Give access'}
        </button>
      </form>

      {notice && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</div>}

      {recipients.length === 0 ? (
        <p className="text-xs text-gray-400">No one has personal access yet{data.hasGeneralPin ? ' — the report is only reachable with the general PIN.' : '.'}</p>
      ) : (
        <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">PIN</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Views</th>
                <th className="px-3 py-2">Last viewed</th>
                <th className="px-3 py-2">Emailed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {recipients.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 last:border-0 ${r.revoked ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{r.name || r.email}</p>
                    {r.name && <p className="text-[11px] text-gray-400">{r.email}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-mono tracking-widest text-gray-900">{reveal[r.id] ? r.pin : '••••••'}</span>
                    <button onClick={() => setReveal(x => ({ ...x, [r.id]: !x[r.id] }))} className="ml-2 text-az hover:text-az-dark">{reveal[r.id] ? 'hide' : 'show'}</button>
                    <button onClick={() => copy(`${report.url}\nPIN: ${r.pin}`, 'Link and PIN')} className="ml-2 text-az hover:text-az-dark">copy invite</button>
                  </td>
                  <td className="px-3 py-2">
                    {r.revoked
                      ? <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">Revoked</span>
                      : <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">Active</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{number(r.view_count)}{r.first_viewed_at && <span className="text-[10px] text-gray-400"> · first {relativeTime(r.first_viewed_at)}</span>}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.last_viewed_at ? relativeTime(r.last_viewed_at) : <span className="text-gray-400">never</span>}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.last_emailed_at ? relativeTime(r.last_emailed_at) : <span className="text-gray-400">no</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button disabled={busy === `resend${r.id}`} onClick={() => run(`resend${r.id}`, async () => { const { data: res } = await api.post(`/analytics/shared-reports/${report.token}/recipients/${r.id}/resend`); return res.emailed ? `PIN emailed to ${r.email}.` : 'Email could not be sent.'; })}
                      className="text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">Resend email</button>
                    <button disabled={busy === `regen${r.id}`} onClick={() => window.confirm(`Give ${r.name || r.email} a new PIN? Their current PIN stops working immediately.`) && run(`regen${r.id}`, async () => { const { data: res } = await api.post(`/analytics/shared-reports/${report.token}/recipients/${r.id}/regenerate`, { sendEmail: true }); setReveal(x => ({ ...x, [r.id]: true })); return `New PIN ${res.recipient.pin}${res.emailed ? ' emailed to ' + r.email : ''}.`; })}
                      className="text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">New PIN</button>
                    <button disabled={busy === `rev${r.id}`} onClick={() => run(`rev${r.id}`, () => api.patch(`/analytics/shared-reports/${report.token}/recipients/${r.id}`, { revoked: !r.revoked }))}
                      className="text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">{r.revoked ? 'Restore' : 'Revoke'}</button>
                    <button disabled={busy === `del${r.id}`} onClick={() => window.confirm(`Remove ${r.name || r.email}? Their PIN stops working and their view history stays in the log.`) && run(`del${r.id}`, () => api.delete(`/analytics/shared-reports/${report.token}/recipients/${r.id}`))}
                      className="text-red-500 hover:text-red-700 disabled:opacity-40">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Activity · last {views.length} view{views.length === 1 ? '' : 's'}</p>
        {views.length === 0 ? (
          <p className="text-xs text-gray-400">No views logged yet.</p>
        ) : (
          <div className="bg-white border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {views.map(v => (
                  <tr key={v.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{v.name || v.email || <span className="text-gray-500">General PIN</span>}</td>
                    <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{fmtWhen(v.viewed_at)}</td>
                    <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{v.ip || ''}</td>
                    <td className="px-3 py-1.5 text-gray-400">{browserOf(v.user_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SharedReports() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [busyToken, setBusyToken] = useState('');
  const [openToken, setOpenToken] = useState('');

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
      pin = window.prompt(`${r.has_pin ? 'New' : 'Set a'} general PIN for "${r.title}" (4–8 digits). Anyone with this PIN can open the report; use "People" below to give individuals their own PIN instead.`);
      if (pin === null) return;
      pin = pin.trim();
      if (!/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits.'); return; }
    } else if (!window.confirm(`Remove the general PIN from "${r.title}"? People with personal PINs keep their access.`)) {
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
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Shared Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reports built and published here — ask Claude to make one, and it'll show up in this list with a
          public link. Give people access by email and each gets their own PIN; every view is logged under their name.
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
                <>
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
                      <button onClick={() => copyLink(r)} className="text-xs font-medium text-az hover:text-az-dark">
                        {copiedToken === r.token ? 'Copied!' : 'Copy link'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setOpenToken(openToken === r.token ? '' : r.token)}
                        className={`text-xs font-semibold mr-3 ${openToken === r.token ? 'text-gray-900' : 'text-az hover:text-az-dark'}`}>
                        {openToken === r.token ? 'Hide people' : 'People'}
                      </button>
                      <button disabled={busyToken === r.token} onClick={() => setPin(r)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">
                        {r.has_pin ? 'Change PIN' : 'Set PIN'}
                      </button>
                      {r.has_pin && (
                        <button disabled={busyToken === r.token} onClick={() => setPin(r, true)}
                          className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">
                          Remove PIN
                        </button>
                      )}
                      <button disabled={busyToken === r.token} onClick={() => toggleRevoke(r)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 mr-3 disabled:opacity-40">
                        {r.revoked ? 'Restore' : 'Revoke'}
                      </button>
                      <button disabled={busyToken === r.token} onClick={() => remove(r)}
                        className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40">
                        Delete
                      </button>
                    </td>
                  </tr>
                  {openToken === r.token && (
                    <tr key={`${r.token}-people`}>
                      <td colSpan={6} className="p-0"><PeoplePanel report={r} onError={setError} /></td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
