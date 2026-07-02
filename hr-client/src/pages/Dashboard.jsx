import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import MealDeductions from './MealDeductions.jsx';

const TABS = [
  { id: 'deductions', label: 'Meal Deductions', icon: ReceiptIcon },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [tab, setTab]    = useState('deductions');

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">

      {/* Sidebar */}
      <aside
        className="w-64 shrink-0 flex flex-col text-white"
        style={{ background: 'linear-gradient(180deg, #0f172a 0%, #0a1120 100%)' }}
      >

        {/* Brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #0f766e, #14b8a6)', boxShadow: '0 4px 14px rgba(20,184,166,0.35)' }}>
              <WaveIcon />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-teal-400/90 leading-none mb-1">Blue Bayou</p>
              <h1 className="text-base font-bold text-white leading-none">HR Portal</h1>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 mb-2">Workspace</p>
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left
                  ${isActive
                    ? 'text-white bg-white/[0.06]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                  }`}
                style={isActive ? { boxShadow: 'inset 0 0 0 1px rgba(20,184,166,0.25)' } : {}}
              >
                {/* Active accent bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-teal-400" />
                )}
                <span className={isActive ? 'text-teal-400' : ''}><Icon /></span>
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-teal-300 shrink-0 border border-teal-500/30"
              style={{ background: 'rgba(20,184,166,0.12)' }}>
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.position || user?.role}</p>
            </div>
          </div>
          <button
            onClick={() => { window.location.href = hubUrl(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-white/[0.04] hover:text-white rounded-lg transition-colors"
          >
            <HomeIcon /> Return Home
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Page header */}
        <div className="bg-white/80 backdrop-blur border-b border-gray-200 px-6 py-4 shrink-0 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">
            {TABS.find(t => t.id === tab)?.label}
          </h2>
          <p className="text-xs text-gray-400 font-medium">{today}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'deductions' && <MealDeductions />}
        </div>
      </main>
    </div>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5" style={{ width: 18, height: 18 }}>
      <path d="M2 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
