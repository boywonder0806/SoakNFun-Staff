import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { hubUrl } from '../../lib/host.js';

const NAV = [
  { to: '/home',          label: 'Home',     icon: HomeIcon      },
  { to: '/schedule',      label: 'Schedule', icon: CalIcon       },
  { to: '/messages',      label: 'Messages', icon: MsgIcon       },
  { to: '/announcements', label: 'Board',    icon: BroadcastIcon },
];
const ADMIN_NAV = [
  { to: '/scheduler',    label: 'T&A',   icon: ClockIcon },
  { to: '/staff/manage', label: 'Staff', icon: StaffIcon },
  { to: '/operations',   label: 'Ops',   icon: OpsIcon   },
];
const MANAGEMENT_NAV = [
  { to: '/reports', label: 'Reports', icon: ReportIcon },
];
const SYSADMIN_NAV = [
  { to: '/sysadmin/departments', label: 'System', icon: ShieldIcon },
];

export default function Sidebar() {
  const { user } = useAuth();

  const isManagement = user?.role === 'sysadmin' || user?.departments?.includes('Management');

  const items =
    user?.role === 'sysadmin' ? [...NAV, ...ADMIN_NAV, ...MANAGEMENT_NAV, ...SYSADMIN_NAV] :
    user?.role === 'manager'  ? [...NAV, ...ADMIN_NAV, ...(isManagement ? MANAGEMENT_NAV : [])] :
    NAV;

  return (
    <aside className="group/nav w-[60px] hover:w-[88px] transition-[width] duration-200 ease-out shrink-0 flex flex-col bg-[#040C17] border-r border-rim/40 overflow-hidden">
      {/* Logo mark */}
      <div className="flex items-center justify-center h-16 shrink-0 border-b border-rim/30">
        <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center">
          <img src="/images/BlueBayou_bv.png" alt="Blue Bayou" className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 min-h-0 flex flex-col items-center py-4 gap-1 overflow-y-auto scrollbar-none">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center w-full h-14 transition-all duration-150 group/link
               ${isActive ? 'text-cyan' : 'text-fog hover:text-fog-hi'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full transition-all duration-200
                  ${isActive ? 'bg-cyan opacity-100' : 'opacity-0'}`}
                />
                <span className={`w-5 h-5 transition-all duration-150 ${isActive ? 'nav-glow' : 'group-hover/link:opacity-80'}`}>
                  <Icon />
                </span>
                <span className="max-h-0 opacity-0 group-hover/nav:max-h-4 group-hover/nav:opacity-100 group-hover/nav:mt-1
                  transition-all duration-150 delay-75 overflow-hidden whitespace-nowrap
                  text-10 font-bold tracking-widest uppercase leading-none">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User + return home */}
      <div className="flex flex-col items-center pb-5 gap-3 border-t border-rim/30 pt-4">
        <button
          onClick={() => { window.location.href = hubUrl(); }}
          className="flex flex-col items-center text-fog hover:text-cyan transition-colors group/out"
          title="Return home"
        >
          <span className="w-5 h-5"><ReturnHomeIcon /></span>
          <span className="max-h-0 opacity-0 group-hover/nav:max-h-4 group-hover/nav:opacity-100 group-hover/nav:mt-1
            transition-all duration-150 delay-75 overflow-hidden whitespace-nowrap
            text-10 font-bold tracking-widest uppercase leading-none">
            Home
          </span>
        </button>
        <div className="w-8 h-8 rounded-full bg-cyan/20 border border-cyan/30 flex items-center justify-center">
          <span className="font-heading font-bold text-cyan text-xs">{user?.avatar}</span>
        </div>
      </div>
    </aside>
  );
}

// ── Exported avatar for pages to use ────────────────────────────────────────
export function Avatar({ initials, dept }) {
  const bg = DEPT_BG[dept] ?? 'bg-cyan/20 border-cyan/30 text-cyan';
  return (
    <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${bg}`}>
      <span className="font-heading font-bold text-xs">{initials}</span>
    </div>
  );
}

export const DEPT_COLOR = {
  'Aquatics':        { bar: 'bg-aq',   text: 'text-aq',   ring: 'border-aq/30',   glow: 'rgba(0,200,255,0.18)'   },
  'Food & Beverage': { bar: 'bg-fb',   text: 'text-fb',   ring: 'border-fb/30',   glow: 'rgba(255,122,0,0.18)'   },
  'Guest Services':  { bar: 'bg-gs',   text: 'text-gs',   ring: 'border-gs/30',   glow: 'rgba(180,85,255,0.18)'  },
  'Management':      { bar: 'bg-mgmt', text: 'text-mgmt', ring: 'border-mgmt/30', glow: 'rgba(255,210,0,0.18)'   },
  'Cleaning Crew':   { bar: 'bg-cc',   text: 'text-cc',   ring: 'border-cc/30',   glow: 'rgba(45,222,152,0.18)'  },
};

const DEPT_BG = {
  'Aquatics':        'bg-aq/20 border-aq/30 text-aq',
  'Food & Beverage': 'bg-fb/20 border-fb/30 text-fb',
  'Guest Services':  'bg-gs/20 border-gs/30 text-gs',
  'Management':      'bg-mgmt/20 border-mgmt/30 text-mgmt',
  'Cleaning Crew':   'bg-cc/20 border-cc/30 text-cc',
};

// ── Icons ────────────────────────────────────────────────────────────────────
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function MsgIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function SchedulerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="4" x2="8" y2="21" />
      <line x1="8" y1="14" x2="21" y2="14" />
      <line x1="8" y1="19" x2="21" y2="19" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function BroadcastIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      {/* board frame */}
      <rect x="2" y="2" width="20" height="16" rx="1.5" />
      {/* stand */}
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
      {/* pinned note lines */}
      <line x1="6" y1="7" x2="14" y2="7" />
      <line x1="6" y1="11" x2="11" y2="11" />
      {/* pushpin */}
      <circle cx="17.5" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function TimeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="15" x2="16" y2="15" />
    </svg>
  );
}
function OpenShiftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  );
}
function StaffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LightningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function OpsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2"  y1="12" x2="4"  y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9"  x2="10" y2="9"  />
    </svg>
  );
}
function ReturnHomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
