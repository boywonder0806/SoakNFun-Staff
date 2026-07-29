import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import FilterBar from './FilterBar.jsx';
import SyncStatus from './SyncStatus.jsx';

const NAV_SECTIONS = [
  {
    heading: 'Analytics',
    items: [
      { to: '/',                label: 'Overview' },
      { to: '/revenue',         label: 'Revenue Trends' },
      { to: '/products',        label: 'Product Mix' },
      { to: '/drinks',          label: 'Drinks' },
      { to: '/cabanas',         label: 'Cabanas' },
      { to: '/offices',         label: 'Sales Offices' },
      { to: '/payment-methods', label: 'Payment Methods' },
      { to: '/refunds',         label: 'Refunds' },
    ],
  },
  {
    heading: 'Reporting',
    items: [
      { to: '/reports/cash-out', label: 'Cash Out Report' },
    ],
  },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  // Reporting pages generate a report on demand with their own date/park
  // controls, rather than reading the shared live-dashboard date filter —
  // so the global filter bar (and its sync-status readout) is irrelevant there.
  const isReportPage = useLocation().pathname.startsWith('/reports');

  function handleLogout() {
    logout();
    window.location.href = hubUrl();
  }

  return (
    <div className="min-h-screen flex bg-slate-100">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col print:hidden">
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

        <nav className="flex-1 px-3 py-4 space-y-4">
          {NAV_SECTIONS.map(section => (
            <div key={section.heading}>
              <p className="px-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{section.heading}</p>
              <div className="space-y-1">
                {section.items.map(item => (
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
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-700 truncate">{user?.name}</p>
          <button onClick={handleLogout} className="mt-2 text-xs text-gray-500 hover:text-gray-800">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 print:w-full">
        {!isReportPage && (
          <div className="sticky top-0 z-10 bg-slate-100/90 backdrop-blur border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap print:hidden">
            <FilterBar />
            <SyncStatus />
          </div>
        )}
        <div className="px-6 py-6 print:p-0">{children}</div>
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
