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
    <div className="min-h-screen bg-gradient-to-br from-bot-bg via-indigo-950 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-bot/20 border border-bot/40 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <BotIcon className="w-8 h-8 text-bot-light" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">BayouBot</h1>
          <p className="text-indigo-300 text-sm mt-1">AI-powered order intelligence</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur border border-white/10 rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-200">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-indigo-200 uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                placeholder="you@example.com"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-bot-light/50 focus:border-bot-light/50 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-indigo-200 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-bot-light/50 focus:border-bot-light/50 transition"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-bot text-white text-sm font-semibold rounded-lg hover:bg-bot-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-indigo-400/50 text-xs mt-6">
          Blue Bayou / Gulf Islands Waterpark
        </p>
      </div>
    </div>
  );
}

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
