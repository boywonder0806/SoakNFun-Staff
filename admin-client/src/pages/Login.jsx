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
      await login(email.trim(), password);
    } catch (err) {
      setError(err.type === 'no_access'
        ? err.message
        : err.response?.data?.error || 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #1c1917 0%, #431407 55%, #7c2d12 100%)' }}>

      <div
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-orange-500/15 blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-amber-500/10 blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm bg-white rounded-3xl overflow-hidden animate-fade-up"
        style={{ boxShadow: '0 24px 60px rgba(28, 12, 2, 0.5), 0 0 0 1px rgba(255,255,255,0.08)' }}>

        <div className="px-8 py-8 text-center"
          style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 60%, #ea580c 100%)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(255,255,255,0.15)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' }}>
            <ShieldIcon />
          </div>
          <h1 className="text-xl font-bold text-white">Blue Bayou</h1>
          <p className="text-sm text-white/80 mt-1 tracking-widest uppercase">Admin Console</p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertIcon />
              <p className="text-xs text-red-600 leading-relaxed">{error}</p>
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input
              type="email" required autoFocus autoComplete="email"
              className="field"
              placeholder="you@bluebayou.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              type="password" required autoComplete="current-password"
              className="field"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>

      <p className="relative mt-6 text-sm text-white/50">
        System administrators only.
      </p>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-red-500 shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
