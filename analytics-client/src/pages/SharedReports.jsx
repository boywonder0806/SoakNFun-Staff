import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api.js';
import { number, relativeTime } from '../lib/format.js';

// The list is tiny metadata (no report HTML), so paint the last copy instantly
// and refresh underneath instead of blocking on a progress screen.
const CACHE_KEY = 'shared-reports:list';
const readCache = () => { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch { return null; } };
const writeCache = rows => { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch { /* storage full/blocked */ } };

const isExpired = r => r.expires_at && new Date(r.expires_at) < new Date();
const isLive = r => !r.revoked && !isExpired(r);
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtWhen = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const browserOf = ua => {
  if (!ua) return '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Other';
};
const initials = s => (s || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

function Pill({ tone = 'gray', children }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/15',
    blue:  'bg-sky-50 text-sky-700 ring-sky-600/15',
    gray:  'bg-gray-100 text-gray-500 ring-gray-500/10',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

function StatusPill({ report }) {
  if (report.revoked) return <Pill>Revoked</Pill>;
  if (isExpired(report)) return <Pill>Expired</Pill>;
  return <Pill tone="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Live</Pill>;
}

function useClickOutside(ref, onOutside, active) {
  useEffect(() => {
    if (!active) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    const k = e => { if (e.key === 'Escape') onOutside(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [active]);
}

function MoreMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button disabled={disabled} onClick={() => setOpen(o => !o)} aria-label="More actions"
        className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-40">
        <DotsIcon />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-48 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          {items.map(it => (
            <button key={it.label} onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full text-left px-3.5 py-2 text-sm ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccessPanel({ report, onError, onChanged }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState('');
  const [reveal, setReveal] = useState({});
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('people');

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
      onChanged();
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

  const recipients = data?.recipients || [];
  const views = data?.views || [];

  return (
    <div className="border-t border-gray-100 bg-slate-50/70 rounded-b-2xl">
      <div className="px-5 pt-3 flex items-center gap-1 border-b border-gray-100">
        {[['people', `People${data ? ` · ${recipients.length}` : ''}`], ['activity', `Activity${data ? ` · ${views.length}` : ''}`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${tab === k ? 'border-az text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {notice && <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</div>}

        {!data ? (
          <div className="space-y-2">{[0, 1].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}</div>
        ) : tab === 'people' ? (
          <>
            <form onSubmit={add} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-2.5">
              <label className="flex-1 min-w-[200px]">
                <span className="block text-[11px] font-semibold text-gray-500 mb-1">Email</span>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="person@example.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-az/25 focus:border-az" />
              </label>
              <label className="w-48">
                <span className="block text-[11px] font-semibold text-gray-500 mb-1">Name <span className="font-normal text-gray-400">(optional)</span></span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="First Last"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-az/25 focus:border-az" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 h-9">
                <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="accent-az" /> Email link &amp; PIN
              </label>
              <button type="submit" disabled={busy === 'add'} className="btn-primary !py-2 !text-xs">
                {busy === 'add' ? 'Adding…' : 'Give access'}
              </button>
            </form>

            {recipients.length === 0 ? (
              <p className="text-xs text-gray-500 px-1">
                No one has a personal PIN yet{data.hasGeneralPin ? ' — right now the report only opens with the general PIN.' : ' — anyone with the link can open this report.'}
              </p>
            ) : (
              <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {recipients.map(r => (
                  <li key={r.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${r.revoked ? 'opacity-60' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-az/10 text-az-dark text-[11px] font-bold flex items-center justify-center shrink-0">{initials(r.name || r.email)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {r.name || r.email} {r.revoked && <span className="ml-1 align-middle"><Pill>Revoked</Pill></span>}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {r.name ? `${r.email} · ` : ''}
                        {r.view_count ? `${number(r.view_count)} view${r.view_count === 1 ? '' : 's'}, last ${relativeTime(r.last_viewed_at)}` : 'not opened yet'}
                        {r.last_emailed_at ? ` · emailed ${relativeTime(r.last_emailed_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg pl-2.5 pr-1 py-1">
                      <span className="font-mono text-sm tracking-[0.2em] text-gray-900 w-[5.5rem]">{reveal[r.id] ? r.pin : '••••••'}</span>
                      <button onClick={() => setReveal(x => ({ ...x, [r.id]: !x[r.id] }))} className="text-[11px] font-semibold text-gray-500 hover:text-gray-900 px-1.5">{reveal[r.id] ? 'Hide' : 'Show'}</button>
                      <button onClick={() => copy(`${report.url}\nPIN: ${r.pin}`, 'Link and PIN')} className="text-[11px] font-semibold text-az-dark hover:text-az px-1.5">Copy invite</button>
                    </div>
                    <MoreMenu disabled={!!busy} items={[
                      { label: 'Resend email', onClick: () => run(`resend${r.id}`, async () => { const { data: res } = await api.post(`/analytics/shared-reports/${report.token}/recipients/${r.id}/resend`); return res.emailed ? `PIN emailed to ${r.email}.` : 'Email could not be sent.'; }) },
                      { label: 'Generate new PIN', onClick: () => window.confirm(`Give ${r.name || r.email} a new PIN? Their current PIN stops working immediately.`) && run(`regen${r.id}`, async () => { const { data: res } = await api.post(`/analytics/shared-reports/${report.token}/recipients/${r.id}/regenerate`, { sendEmail: true }); setReveal(x => ({ ...x, [r.id]: true })); return `New PIN ${res.recipient.pin}${res.emailed ? ' emailed to ' + r.email : ''}.`; }) },
                      { label: r.revoked ? 'Restore access' : 'Revoke access', onClick: () => run(`rev${r.id}`, () => api.patch(`/analytics/shared-reports/${report.token}/recipients/${r.id}`, { revoked: !r.revoked })) },
                      { label: 'Remove person', danger: true, onClick: () => window.confirm(`Remove ${r.name || r.email}? Their PIN stops working and their view history stays in the log.`) && run(`del${r.id}`, () => api.delete(`/analytics/shared-reports/${report.token}/recipients/${r.id}`)) },
                    ]} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : views.length === 0 ? (
          <p className="text-xs text-gray-500 px-1">No views logged yet.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-2">Who</th><th className="px-4 py-2">When</th><th className="px-4 py-2">IP</th><th className="px-4 py-2">Device</th>
                </tr>
              </thead>
              <tbody>
                {views.map(v => (
                  <tr key={v.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{v.name || v.email || <span className="text-gray-500">General PIN / open link</span>}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtWhen(v.viewed_at)}</td>
                    <td className="px-4 py-2 text-gray-400 whitespace-nowrap font-mono">{v.ip || ''}</td>
                    <td className="px-4 py-2 text-gray-400">{browserOf(v.user_agent)}</td>
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

function ReportCard({ r, open, onToggle, busy, copied, onCopy, onSetPin, onRevoke, onDelete, onError, onChanged }) {
  const live = isLive(r);
  return (
    <div className={`card transition-shadow ${open ? 'shadow-md ring-1 ring-az/20' : 'hover:shadow-md'} ${live ? '' : 'opacity-75'}`}>
      <div className="p-5 flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${live ? 'bg-az/10 text-az-dark' : 'bg-gray-100 text-gray-400'}`}>
          <ReportIcon />
        </div>

        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-gray-900 leading-snug">{r.title}</h2>
            <StatusPill report={r} />
            {r.has_pin && <Pill tone="amber"><LockIcon />General PIN</Pill>}
            {r.people_count > 0 && <Pill tone="blue">{r.people_count} {r.people_count === 1 ? 'person' : 'people'}</Pill>}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Created {fmtDate(r.created_at)}{r.created_by ? ` by ${r.created_by}` : ''}
            <span className="mx-1.5 text-gray-300">•</span>
            <span className="tabular-nums">{number(r.view_count)} view{r.view_count === 1 ? '' : 's'}</span>
            {r.last_viewed_at && <span className="text-gray-400">, last {relativeTime(r.last_viewed_at)}</span>}
            {r.expires_at && !isExpired(r) && <><span className="mx-1.5 text-gray-300">•</span>expires {fmtDate(r.expires_at)}</>}
          </p>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn-primary !py-2 !px-3.5 !text-xs">
            Open <ExternalIcon />
          </a>
          <button onClick={onCopy} className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            {copied ? <><CheckIcon />Copied</> : <><LinkIcon />Copy link</>}
          </button>
          <button onClick={onToggle}
            className={`h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border text-xs font-semibold ${open ? 'border-az/40 bg-az/5 text-az-dark' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            <PeopleIcon />Access
            <Chevron open={open} />
          </button>
          <MoreMenu disabled={busy} items={[
            { label: r.has_pin ? 'Change general PIN' : 'Set general PIN', onClick: onSetPin },
            { label: r.revoked ? 'Restore link' : 'Revoke link', onClick: onRevoke },
            { label: 'Delete report', danger: true, onClick: onDelete },
          ]} />
        </div>
      </div>
      {open && <AccessPanel report={r} onError={onError} onChanged={onChanged} />}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="card p-5 flex items-center gap-5">
      <div className="w-11 h-11 rounded-xl bg-gray-100 animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-64 rounded bg-gray-100 animate-pulse" />
        <div className="h-3 w-80 rounded bg-gray-100 animate-pulse" />
      </div>
      <div className="h-9 w-48 rounded-xl bg-gray-100 animate-pulse" />
    </div>
  );
}

export default function SharedReports() {
  const [reports, setReports] = useState(readCache);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [busyToken, setBusyToken] = useState('');
  const [openToken, setOpenToken] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/analytics/shared-reports');
      setReports(data);
      writeCache(data);
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

  async function act(r, fn, failMsg) {
    setBusyToken(r.token);
    try {
      await fn();
      setError('');
      await load();
    } catch {
      setError(failMsg);
    } finally {
      setBusyToken('');
    }
  }

  function toggleRevoke(r) {
    if (!r.revoked && !window.confirm(`Revoke "${r.title}"? The link stops working for everyone until you restore it.`)) return;
    act(r, () => api.patch(`/analytics/shared-reports/${r.token}/revoke`, { revoked: !r.revoked }), 'Failed to update that report.');
  }

  function setPin(r) {
    let pin = window.prompt(`${r.has_pin ? 'New' : 'Set a'} general PIN for "${r.title}" (4–8 digits). Anyone with this PIN can open the report; use "Access" to give individuals their own PIN instead.${r.has_pin ? '\n\nLeave blank to remove the general PIN.' : ''}`);
    if (pin === null) return;
    pin = pin.trim();
    if (!pin && r.has_pin) {
      if (!window.confirm(`Remove the general PIN from "${r.title}"? People with personal PINs keep their access.`)) return;
      pin = null;
    } else if (!/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits.'); return; }
    act(r, () => api.patch(`/analytics/shared-reports/${r.token}/pin`, { pin }), 'Failed to update the PIN.');
  }

  function remove(r) {
    if (!window.confirm(`Permanently delete "${r.title}"? The link will stop working immediately.`)) return;
    act(r, () => api.delete(`/analytics/shared-reports/${r.token}`), 'Failed to delete that report.');
  }

  const { live, inactive, totals } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (reports || []).filter(r => !q || r.title.toLowerCase().includes(q) || (r.created_by || '').toLowerCase().includes(q));
    return {
      live: rows.filter(isLive),
      inactive: rows.filter(r => !isLive(r)),
      totals: {
        live: (reports || []).filter(isLive).length,
        views: (reports || []).reduce((s, r) => s + (r.view_count || 0), 0),
        people: (reports || []).reduce((s, r) => s + (r.people_count || 0), 0),
      },
    };
  }, [reports, query]);

  const card = r => (
    <ReportCard key={r.token} r={r}
      open={openToken === r.token} onToggle={() => setOpenToken(openToken === r.token ? '' : r.token)}
      busy={busyToken === r.token} copied={copiedToken === r.token}
      onCopy={() => copyLink(r)} onSetPin={() => setPin(r)} onRevoke={() => toggleRevoke(r)} onDelete={() => remove(r)}
      onError={setError} onChanged={load} />
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Shared Reports</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Published reports with a shareable link. Use <span className="font-semibold text-gray-700">Access</span> to give
            someone their own PIN — every view is logged under their name.
          </p>
        </div>
        {reports && reports.length > 0 && (
          <div className="flex items-center gap-2">
            <Stat label="Live" value={totals.live} />
            <Stat label="Views" value={number(totals.views)} />
            <Stat label="People" value={totals.people} />
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { setError(''); load(); }} className="text-xs font-semibold underline">Retry</button>
        </div>
      )}

      {!reports ? (
        error ? null : <div className="space-y-3">{[0, 1, 2].map(i => <SkeletonCard key={i} />)}</div>
      ) : reports.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-az/10 text-az-dark flex items-center justify-center"><ReportIcon /></div>
          <p className="mt-4 text-sm font-semibold text-gray-900">No shared reports yet</p>
          <p className="mt-1 text-sm text-gray-500">Ask Claude to build one and it will show up here with a link.</p>
        </div>
      ) : (
        <>
          {reports.length > 4 && (
            <div className="relative max-w-sm">
              <SearchIcon />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search reports"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-az/25 focus:border-az" />
            </div>
          )}

          <section className="space-y-3">
            {live.length ? live.map(card) : <p className="text-sm text-gray-400 px-1">{query ? 'No live reports match.' : 'No live reports.'}</p>}
          </section>

          {inactive.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1">Revoked &amp; expired</h3>
              {inactive.map(card)}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3.5 py-2 min-w-[76px]">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-base font-bold text-gray-900 tabular-nums leading-tight">{value}</p>
    </div>
  );
}

const svg = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' };
const ReportIcon = () => <svg {...svg} className="w-5 h-5"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 17v-3M12 17v-5M15 17v-2" /></svg>;
const ExternalIcon = () => <svg {...svg} className="w-3.5 h-3.5"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
const LinkIcon = () => <svg {...svg} className="w-3.5 h-3.5"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
const CheckIcon = () => <svg {...svg} className="w-3.5 h-3.5 text-az"><path d="M20 6 9 17l-5-5" /></svg>;
const PeopleIcon = () => <svg {...svg} className="w-3.5 h-3.5"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>;
const LockIcon = () => <svg {...svg} className="w-3 h-3"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
const DotsIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
const Chevron = ({ open }) => <svg {...svg} className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>;
const SearchIcon = () => <svg {...svg} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
