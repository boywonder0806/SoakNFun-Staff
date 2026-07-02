import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Production tool URLs; dev falls back to the Vite ports
function toolUrl(sub, devPort) {
  if (window.location.hostname === 'localhost') return `http://localhost:${devPort}`;
  return `https://${sub}.bluebayoustaff.com`;
}

export default function Launcher() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const token = localStorage.getItem('bb_token');

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = user?.name?.split(' ')[0] || 'there';

  // SSO handoff: token travels in the URL fragment (never sent to the server)
  // and each tool stores it locally on arrival.
  const sso = (url) => `${url}/#sso=${token}`;

  const tools = [
    {
      id: 'staff',
      name: 'Staff Portal',
      desc: 'Schedules, shift board, time off, messages, and announcements',
      accent: '#00C8FF',
      Icon: WaveIcon,
      show: true,
      onClick: () => navigate(user?.role === 'manager' || user?.role === 'sysadmin' ? '/scheduler' : '/home'),
    },
    {
      id: 'hr',
      name: 'HR Portal',
      desc: 'Live meal deductions, payroll reports, and camera review',
      accent: '#2DDE98',
      Icon: ClipboardIcon,
      show: !!user?.hasHrAccess,
      href: sso(toolUrl('hr', 5175)),
    },
    {
      id: 'reception',
      name: 'Reception',
      desc: 'Call log, callbacks, and lost & found',
      accent: '#FFD200',
      Icon: PhoneIcon,
      show: !!user?.hasReceptionAccess,
      href: sso(toolUrl('reception', 5174)),
    },
    {
      id: 'bot',
      name: 'BayouBot',
      desc: 'AI assistant with live RocketRez order intelligence',
      accent: '#B455FF',
      Icon: BotIcon,
      show: !!user?.hasBotAccess,
      href: sso(toolUrl('bot', 5176)),
    },
    {
      id: 'admin',
      name: 'Admin Console',
      desc: 'User accounts, tool access, and platform administration',
      accent: '#FF7A00',
      Icon: ShieldIcon,
      show: user?.role === 'sysadmin',
      href: sso(toolUrl('admin', 5177)),
    },
  ].filter(t => t.show);

  return (
    <div className="relative min-h-screen bg-void overflow-hidden flex flex-col">

      {/* Ambient background */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,200,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,255,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,200,255,0.10) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-32 -right-32 w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,210,0,0.07) 0%, transparent 70%)' }} />

      {/* Header */}
      <header className="relative flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #1B2A6B, #2A3D9A)', boxShadow: '0 4px 18px rgba(0,200,255,0.25)' }}>
            <WaveIcon color="#00C8FF" />
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-cyan leading-none mb-1">Blue Bayou Waterpark</p>
            <p className="text-sm font-bold text-ink leading-none">Staff Platform</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="text-xs font-semibold text-fog hover:text-red-400 transition-colors px-3 py-2 rounded-lg hover:bg-white/5"
        >
          Sign Out
        </button>
      </header>

      {/* Body */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-ink font-heading">
              Good {timeOfDay}, {firstName}
            </h1>
            <p className="text-sm text-fog mt-2">
              {tools.length === 1 ? 'Your tool is ready' : `You have access to ${tools.length} tools`}
            </p>
          </div>

          <div className={`grid gap-4 ${tools.length <= 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto' : tools.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {tools.map((t, i) => {
              const inner = (
                <>
                  {/* Accent glow on hover */}
                  <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ boxShadow: `inset 0 0 0 1px ${t.accent}66, 0 8px 32px ${t.accent}22` }} />

                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: `${t.accent}1A`, boxShadow: `inset 0 0 0 1px ${t.accent}40` }}>
                    <t.Icon color={t.accent} />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-bold text-ink">{t.name}</p>
                    <ArrowIcon className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" color={t.accent} />
                  </div>
                  <p className="text-xs text-fog mt-1.5 leading-relaxed">{t.desc}</p>
                </>
              );
              const cls = 'group relative text-left bg-deep border border-rim/60 rounded-2xl p-5 hover:bg-shell transition-colors cursor-pointer block';
              const style = { animationDelay: `${i * 60}ms` };
              return t.href ? (
                <a key={t.id} href={t.href} className={cls} style={style}>{inner}</a>
              ) : (
                <button key={t.id} onClick={t.onClick} className={cls} style={style}>{inner}</button>
              );
            })}
          </div>

          <p className="text-center text-xs text-fog/60 mt-10">
            One login, every tool — you won't need to sign in again.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

function WaveIcon({ color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
      <path d="M2 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    </svg>
  );
}

function ClipboardIcon({ color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function PhoneIcon({ color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function BotIcon({ color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="9" width="18" height="12" rx="3" />
      <circle cx="8.5" cy="15" r="1.25" fill={color} stroke="none" />
      <circle cx="15.5" cy="15" r="1.25" fill={color} stroke="none" />
      <path d="M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
      <line x1="12" y1="7" x2="12" y2="9" />
    </svg>
  );
}

function ShieldIcon({ color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ArrowIcon({ className = '', color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 ${className}`}>
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
