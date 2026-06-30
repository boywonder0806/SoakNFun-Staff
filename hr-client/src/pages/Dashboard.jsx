import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import MealDeductions from './MealDeductions.jsx';
import RocketRezSync from './RocketRezSync.jsx';

const TABS = [
  { id: 'deductions', label: 'Meal Deductions', icon: ReceiptIcon },
  { id: 'gen2',       label: 'Live Orders (Gen 2)', icon: SyncTabIcon },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab]    = useState('deductions');

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">

      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-gray-900 flex flex-col text-white">

        {/* Brand */}
        <div className="px-6 pt-6 pb-5 border-b border-gray-800">
          <p className="text-xs font-bold tracking-widest uppercase text-brand-light mb-0.5">Blue Bayou</p>
          <h1 className="text-xl font-bold text-white leading-tight">HR Portal</h1>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left
                  ${isActive
                    ? 'bg-brand text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
              >
                <Icon />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-xs font-bold text-brand-light shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.position || user?.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <LogoutIcon /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Page header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
          <h2 className="text-base font-bold text-gray-900">
            {TABS.find(t => t.id === tab)?.label}
          </h2>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'deductions' && <MealDeductions />}
          {tab === 'gen2' && <RocketRezSync />}
        </div>
      </main>
    </div>
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

function SyncTabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
