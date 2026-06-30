import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#030712] flex items-center justify-center overflow-hidden p-4">

      {/* ── Animated background ─────────────────────────────────────────── */}
      {/* Grid */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />

      {/* Gradient orbs */}
      <div className="absolute top-1/4 -left-20 w-[500px] h-[500px] rounded-full bg-indigo-700/20 blur-[100px] animate-blob" />
      <div className="absolute bottom-1/4 -right-20 w-[500px] h-[500px] rounded-full bg-cyan-700/15 blur-[100px] animate-blob-2" />
      <div className="absolute top-2/3 left-1/3 w-[300px] h-[300px] rounded-full bg-violet-700/10 blur-[80px] animate-blob-3" />

      {/* Scan line */}
      <div
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent animate-scan pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-sm animate-fade-up">

        {/* Logo + title */}
        <div className="text-center mb-10">
          {/* Animated icon */}
          <div className="relative inline-flex items-center justify-center mb-6 animate-float">
            {/* Outer glow ring */}
            <div className="absolute w-24 h-24 rounded-full bg-indigo-500/10 animate-ping" style={{ animationDuration: '2.5s' }} />
            {/* Ring */}
            <div className="absolute w-20 h-20 rounded-full border border-indigo-500/20 animate-spin-slow" />
            {/* Inner container */}
            <div className="relative w-16 h-16 rounded-2xl bg-[#0d1117] border border-indigo-500/40 flex items-center justify-center glow-box">
              <BotIcon className="w-8 h-8 text-indigo-400" />
            </div>
          </div>

          <h1 className="text-5xl font-extrabold tracking-tight gradient-text leading-none mb-3">
            BayouBot
          </h1>
          <p className="text-slate-400 text-sm tracking-widest uppercase">
            AI Order Intelligence
          </p>
          {/* Cursor blink */}
          <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-1 align-middle animate-blink" />
        </div>

        {/* Glass card */}
        <div className="relative">
          {/* Glowing border effect */}
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/50 via-cyan-500/30 to-violet-500/50 opacity-50 blur-sm" />

          <div className="relative bg-[#0a0f1e]/90 backdrop-blur-xl border border-white/8 rounded-2xl p-7">
            {error && (
              <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
                <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                  Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:shadow-[0_0_0_2px_rgba(99,102,241,0.15),0_0_20px_rgba(99,102,241,0.08)] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:shadow-[0_0_0_2px_rgba(99,102,241,0.15),0_0_20px_rgba(99,102,241,0.08)] transition-all"
                />
              </div>

              {/* Gradient button */}
              <button
                type="submit"
                disabled={loading}
                className="relative w-full py-3 rounded-xl text-sm font-bold text-white overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-transform active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #2563eb 100%)',
                  boxShadow: '0 0 30px rgba(99,102,241,0.4)',
                }}
              >
                {/* Shine sweep */}
                {!loading && (
                  <span
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
                      animation: 'shimmer 3s linear infinite',
                      backgroundSize: '200% 100%',
                    }}
                  />
                )}
                <span className="relative flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <SpinnerIcon />
                      Authenticating…
                    </>
                  ) : (
                    <>
                      <LockIcon />
                      Access BayouBot
                    </>
                  )}
                </span>
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-8 tracking-wider uppercase">
          Blue Bayou · Gulf Islands Waterpark
        </p>
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */
function BotIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="9" width="18" height="12" rx="3" />
      <circle cx="8.5" cy="15" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9 19.5h6" />
      <path d="M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
      <line x1="12" y1="7" x2="12" y2="9" />
    </svg>
  );
}

function AlertIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}
