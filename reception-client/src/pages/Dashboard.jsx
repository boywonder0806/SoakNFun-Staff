import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import CallLog from './CallLog.jsx';
import LostFound from './LostFound.jsx';
import Configurator from './Configurator.jsx';

const BASE_TABS = [
  { id: 'calls',     label: 'Calls',        icon: PhoneIcon },
  { id: 'lostfound', label: 'Lost & Found', icon: TagIcon   },
];
const MANAGER_TABS = [
  { id: 'configurator', label: 'Configurator', icon: GearIcon },
];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab]    = useState('calls');
  const TABS = user?.isReceptionManager ? [...BASE_TABS, ...MANAGER_TABS] : BASE_TABS;
  const [counts, setCounts] = useState({ pendingCallbacks: 0, unclaimed: 0, todayCalls: 0 });
  const now = useClock();

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">

      {/* Sidebar */}
      <aside className="w-72 shrink-0 bg-gray-900 flex flex-col text-white">

        {/* Brand */}
        <div className="px-6 pt-6 pb-4">
          <p className="text-xs font-bold tracking-widest uppercase text-brand-light mb-0.5">Blue Bayou</p>
          <h1 className="text-xl font-bold text-white leading-tight">Reception</h1>
        </div>

        {/* Clock */}
        <div className="mx-4 mb-4 bg-gray-800 rounded-xl px-4 py-3">
          <p className="text-3xl font-bold text-white tabular-nums tracking-tight">{timeStr}</p>
          <p className="text-xs text-gray-400 mt-0.5">{dateStr}</p>
        </div>

        {/* Stats */}
        <div className="mx-4 mb-5 grid grid-cols-3 gap-2">
          <div className="bg-gray-800 rounded-lg px-2 py-2.5 text-center">
            <p className={`text-xl font-bold tabular-nums ${counts.pendingCallbacks > 0 ? 'text-amber-400' : 'text-white'}`}>
              {counts.pendingCallbacks}
            </p>
            <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Pending<br/>Callbacks</p>
          </div>
          <div className="bg-gray-800 rounded-lg px-2 py-2.5 text-center">
            <p className={`text-xl font-bold tabular-nums ${counts.unclaimed > 0 ? 'text-blue-400' : 'text-white'}`}>
              {counts.unclaimed}
            </p>
            <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Unclaimed<br/>Items</p>
          </div>
          <div className="bg-gray-800 rounded-lg px-2 py-2.5 text-center">
            <p className="text-xl font-bold tabular-nums text-white">{counts.todayCalls}</p>
            <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Today's<br/>Calls</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-1">
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
                {t.id === 'calls' && counts.pendingCallbacks > 0 && (
                  <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full
                    ${isActive ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-400'}`}>
                    {counts.pendingCallbacks}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-gray-800 mt-4">
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
      <main className="flex-1 min-w-0 overflow-hidden">
        {tab === 'calls' && (
          <CallLog
            onTodayCallsCount={n => setCounts(c => ({ ...c, todayCalls: n }))}
            onPendingCallbacksCount={n => setCounts(c => ({ ...c, pendingCallbacks: n }))}
          />
        )}
        {tab === 'lostfound' && (
          <LostFound onUnclaimedCount={n => setCounts(c => ({ ...c, unclaimed: n }))} />
        )}
        {tab === 'configurator' && <Configurator />}
      </main>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l1.62-1.62a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
