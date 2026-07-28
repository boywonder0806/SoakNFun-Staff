import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import FilterBar from './FilterBar.jsx';
import SyncStatus from './SyncStatus.jsx';

const NAV = [
  { to: '/',                label: 'Overview' },
  { to: '/revenue',         label: 'Revenue Trends' },
  { to: '/products',        label: 'Product Mix' },
  { to: '/drinks',          label: 'Drinks' },
  { to: '/offices',         label: 'Sales Offices' },
  { to: '/payment-methods', label: 'Payment Methods' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    window.location.href = hubUrl();
  }

  return (
    <div className="min-h-screen flex bg-slate-100">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #0a8a66 0%, #0ca67a 100%)' }}>
              <ChartIcon />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Blue Bayou</p>
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Analytics</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `block px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive ? 'bg-az/10 text-az-dark' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-700 truncate">{user?.name}</p>
          <button onClick={handleLogout} className="mt-2 text-xs text-gray-500 hover:text-gray-800">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-10 bg-slate-100/90 backdrop-blur border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <FilterBar />
          <SyncStatus />
        </div>
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 3v18h18" />
      <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
    </svg>
  );
}
