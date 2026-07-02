import { NavLink, Outlet } from 'react-router-dom';

// User management now lives in the Admin Console (admin.bluebayoustaff.com)
const SUB_NAV = [
  { to: '/sysadmin/departments', label: 'Depts', icon: DeptIcon  },
  { to: '/sysadmin/logs',        label: 'Logs',  icon: LogsIcon  },
  { to: '/sysadmin/api',         label: 'API',   icon: ApiIcon   },
];

export default function SystemAdminLayout() {
  return (
    <div className="flex -mx-6 -mt-6 -mb-6" style={{ height: '100vh' }}>

      {/* Sub-sidebar */}
      <aside className="group/subnav w-[60px] hover:w-[88px] transition-[width] duration-200 ease-out shrink-0 flex flex-col bg-[#030A12] border-r border-rim/30 overflow-hidden">
        <div className="flex items-center justify-center h-12 shrink-0 border-b border-rim/20">
          <span className="text-10 font-black tracking-widest uppercase text-gold whitespace-nowrap opacity-0 group-hover/subnav:opacity-100 transition-opacity duration-150 delay-75">
            System
          </span>
        </div>

        <nav className="flex-1 flex flex-col items-center py-3 gap-0.5">
          {SUB_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center w-full h-14 transition-all duration-150 group/link
                 ${isActive ? 'text-gold' : 'text-fog hover:text-fog-hi'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full transition-all duration-200
                    ${isActive ? 'bg-gold opacity-100' : 'opacity-0'}`}
                  />
                  <span className={`w-5 h-5 transition-all duration-150
                    ${isActive ? 'drop-shadow-[0_0_8px_rgba(255,210,0,0.70)]' : 'group-hover/link:opacity-80'}`}>
                    <Icon />
                  </span>
                  <span className="max-h-0 opacity-0 group-hover/subnav:max-h-4 group-hover/subnav:opacity-100 group-hover/subnav:mt-1
                    transition-all duration-150 delay-75 overflow-hidden whitespace-nowrap
                    text-10 font-bold tracking-widest uppercase leading-none">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}

function DeptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <rect x="2" y="18" width="5" height="4" rx="1" />
      <rect x="9.5" y="18" width="5" height="4" rx="1" />
      <rect x="17" y="18" width="5" height="4" rx="1" />
      <line x1="12" y1="6" x2="12" y2="12" />
      <line x1="4.5" y1="12" x2="19.5" y2="12" />
      <line x1="4.5" y1="12" x2="4.5" y2="18" />
      <line x1="12" y1="12" x2="12" y2="18" />
      <line x1="19.5" y1="12" x2="19.5" y2="18" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function ApiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
    </svg>
  );
}
