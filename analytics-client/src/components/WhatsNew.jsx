import { useEffect, useState } from 'react';

// Release notes shown on the Shared Reports page once per login until SHOW_UNTIL.
// Each login issues a new token, so "seen" is remembered against the current token:
// dismissing hides it for this session and it returns after the next sign-in.
const RELEASE = 'shared-reports-2026-11-02';
const SHOW_UNTIL = new Date('2026-11-10T00:00:00-06:00'); // through Sun Nov 9, Central

const UPDATES = [
  {
    title: 'Export the 2026 Season Per Cap Dashboard',
    body: 'Use Export in the top right of the dashboard to download a formatted PDF report, an Excel workbook with a tab for each section, or a CSV. Every export follows the filters you have applied.',
    icon: 'export',
  },
  {
    title: 'Redesigned Shared Reports',
    body: 'Each report now has Open, Copy link and Access in one place. Access is where you add people, send their PIN and see who has viewed the report.',
    icon: 'layout',
  },
  {
    title: 'Analytics dashboards temporarily unavailable',
    body: 'The dashboards under Analytics are paused while they are under continued development. Shared reports are not affected.',
    icon: 'pause',
  },
];

const seenKey = () => `whatsnew:${RELEASE}`;
const tokenTag = () => { try { return (localStorage.getItem('analytics_token') || '').slice(-24); } catch { return ''; } };

export default function WhatsNew() {
  const [open, setOpen] = useState(() => {
    if (Date.now() >= SHOW_UNTIL.getTime()) return false;
    try { return localStorage.getItem(seenKey()) !== tokenTag(); } catch { return true; }
  });

  function dismiss() {
    try { localStorage.setItem(seenKey(), tokenTag()); } catch { /* storage blocked: shows again next visit */ }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const k = e => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px] animate-fade-up"
      onMouseDown={e => { if (e.target === e.currentTarget) dismiss(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="whatsnew-title" className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <p className="text-[11px] font-semibold text-az-dark uppercase tracking-wide">Updates · November 2, 2026</p>
          <h2 id="whatsnew-title" className="mt-1 text-lg font-bold text-gray-900">What's new</h2>
        </div>
        <ul className="px-6 py-5 space-y-5">
          {UPDATES.map(u => (
            <li key={u.title} className="flex gap-3.5">
              <div className="w-9 h-9 rounded-md bg-az/10 text-az-dark flex items-center justify-center shrink-0"><Icon name={u.icon} /></div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{u.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-600">{u.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button onClick={dismiss} autoFocus className="btn-primary !rounded-md !py-2 !px-5 !text-sm">Got it</button>
        </div>
      </div>
    </div>
  );
}

function Icon({ name }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', className: 'w-[18px] h-[18px]' };
  if (name === 'export') return <svg {...p}><path d="M12 15V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></svg>;
  if (name === 'layout') return <svg {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>;
}
