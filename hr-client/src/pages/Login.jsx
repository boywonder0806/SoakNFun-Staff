import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function classifyError(err) {
  if (err.type === 'no_access') return 'no_access';
  const status  = err.response?.status;
  const message = (err.response?.data?.error || '').toLowerCase();
  if (status === 403 || message.includes('locked')) return 'locked';
  if (status === 401) return 'credentials';
  return 'server';
}

function getErrorMessage(err) {
  return err.response?.data?.error || err.message || 'Unable to sign in. Please try again.';
}

export default function Login() {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [errorType, setErrorType]     = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading]         = useState(false);
  const { login }                     = useAuth();
  const navigate                      = useNavigate();

  const [sessionError] = useState(() => {
    const msg = sessionStorage.getItem('hr_session_error');
    if (msg) sessionStorage.removeItem('hr_session_error');
    return msg || null;
  });

  function clearError() { setErrorType(null); setErrorMessage(''); }

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();
    if (!email.trim() || !password) {
      setErrorType('credentials');
      setErrorMessage('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setErrorType(classifyError(err));
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #042f2e 0%, #0d5c55 45%, #0f766e 100%)' }}>

      {/* Subtle dot texture + glow accents */}
      <div
        className="absolute inset-0 opacity-[0.15] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-teal-400/15 blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-emerald-400/10 blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm bg-white rounded-3xl overflow-hidden animate-fade-up"
        style={{ boxShadow: '0 24px 60px rgba(2, 44, 34, 0.45), 0 0 0 1px rgba(255,255,255,0.08)' }}>

        {/* Header */}
        <div className="px-8 py-8 text-center"
          style={{ background: 'linear-gradient(135deg, #0d5c55 0%, #0f766e 60%, #0d9488 100%)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(255,255,255,0.15)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' }}>
            <BriefcaseIcon />
          </div>
          <h1 className="text-xl font-bold text-white">Blue Bayou</h1>
          <p className="text-sm text-white/80 mt-1 tracking-widest uppercase">HR Portal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">

          {sessionError && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <BlockIcon className="text-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-700">Session ended</p>
                <p className="text-xs text-red-500 mt-0.5">{sessionError}</p>
              </div>
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className={`field ${errorType === 'credentials' ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
              placeholder="you@bluebayou.com"
              value={email}
              onChange={e => { setEmail(e.target.value); clearError(); }}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className={`field ${errorType === 'credentials' ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
              placeholder="••••••••"
              value={password}
              onChange={e => { setPassword(e.target.value); clearError(); }}
              autoComplete="current-password"
            />
          </div>

          {errorType === 'credentials' && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertIcon className="text-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-700">Incorrect credentials</p>
                <p className="text-xs text-red-500 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {errorType === 'locked' && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <LockIcon className="text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Account locked</p>
                <p className="text-xs text-amber-600 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {errorType === 'no_access' && (
            <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
              <BlockIcon className="text-orange-500" />
              <div>
                <p className="text-sm font-semibold text-orange-800">No HR access</p>
                <p className="text-xs text-orange-600 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {errorType === 'server' && (
            <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <AlertIcon className="text-gray-400" />
              <div>
                <p className="text-sm font-semibold text-gray-700">Something went wrong</p>
                <p className="text-xs text-gray-500 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-base">
            {loading ? <><Spinner /> Signing in…</> : 'Sign In'}
          </button>
        </form>
      </div>

      <p className="relative mt-6 text-sm text-white/60">
        Contact your administrator if you need access.
      </p>
    </div>
  );
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-8 h-8 shrink-0 mt-0.5">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <line x1="12" y1="12" x2="12" y2="12" />
      <path d="M2 12h20" />
    </svg>
  );
}

function AlertIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 shrink-0 mt-0.5 ${className}`}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function LockIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 shrink-0 mt-0.5 ${className}`}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function BlockIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 shrink-0 mt-0.5 ${className}`}>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />;
}
