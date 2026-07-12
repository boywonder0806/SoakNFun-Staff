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
      setError(err.type === 'no_access' ? err.message : (err.response?.data?.error || 'Login failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-slate-100 flex items-center justify-center p-4 overflow-hidden">

      {/* Subtle ticket-stub backdrop */}
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(225,29,72,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(225,29,72,0.05) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(225,29,72,0.08) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-24 -left-24 w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,200,255,0.08) 0%, transparent 70%)' }} />

      <div className="relative z-10 w-full max-w-sm animate-fade-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #e11d48, #f43f5e)' }}>
            <TicketIcon className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Ticket Manager</h1>
          <p className="text-sm text-gray-500 mt-1">Custom tickets with scannable barcodes</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-7">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email" required autoFocus value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" className="field"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password" required value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" className="field"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6 tracking-wider uppercase">
          Blue Bayou · Gulf Islands Waterpark
        </p>
      </div>
    </div>
  );
}

export function TicketIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 9a3 3 0 0 1 0 6v3a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3z" />
      <line x1="13" y1="5" x2="13" y2="7" />
      <line x1="13" y1="11" x2="13" y2="13" />
      <line x1="13" y1="17" x2="13" y2="19" />
    </svg>
  );
}
