import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api.js';

export default function ResetPassword() {
  const [params]   = useSearchParams();
  const token      = params.get('token') || '';
  const navigate   = useNavigate();

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm)  { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-4 relative overflow-hidden">

      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-cyan/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-navy/60 blur-[120px] pointer-events-none" />

      <div className="mb-10 text-center relative z-10">
        <div className="w-28 h-28 mx-auto flex items-center justify-center">
          <img src="/images/BlueBayou_bv.png" alt="Blue Bayou" className="w-full h-full object-contain" />
        </div>
        <p className="mt-3 text-sm font-bold tracking-widest uppercase text-white">Staff Portal</p>
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="panel p-8">
          {done ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-green-500/15 border border-green-500/25">
                <CheckIcon />
              </div>
              <p className="font-bold text-ink">Password updated!</p>
              <p className="text-sm text-fog">Redirecting you to sign in…</p>
            </div>
          ) : !token ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-fog">This reset link is missing or invalid.</p>
              <Link to="/login" className="text-sm text-cyan hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-ink mb-1">Set a new password</h2>
                <p className="text-xs text-fog">Must be at least 6 characters.</p>
              </div>

              <div>
                <label className="label-xs block mb-2">New Password</label>
                <input
                  type="password"
                  className="field"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  autoFocus
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="label-xs block mb-2">Confirm Password</label>
                <input
                  type="password"
                  className="field"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError(''); }}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs font-semibold">{error}</p>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                ) : 'Update Password'}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-xs text-fog hover:text-fog-hi transition-colors">Back to sign in</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-6 h-6 text-green-400">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
