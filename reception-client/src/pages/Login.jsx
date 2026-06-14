import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// error types: 'credentials' | 'locked' | 'no_access' | 'server'
function classifyError(err) {
  if (err.type === 'no_access') return 'no_access';
  const status  = err.response?.status;
  const message = (err.response?.data?.error || '').toLowerCase();
  if (status === 403 || message.includes('locked')) return 'locked';
  if (status === 401) return 'credentials';
  return 'server';
}

function getErrorMessage(err) {
  // Prefer server's message over axios's generic message
  return err.response?.data?.error || err.message || 'Unable to sign in. Please try again.';
}

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [errorType, setErrorType]   = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuth();
  const navigate                = useNavigate();

  // Pick up error reason passed via sessionStorage from the API interceptor
  const [sessionError] = useState(() => {
    const msg = sessionStorage.getItem('rc_session_error');
    if (msg) sessionStorage.removeItem('rc_session_error');
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
    <div className="min-h-screen bg-gradient-to-br from-brand-dark via-brand to-brand-light flex flex-col items-center justify-center px-4">

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-brand px-8 py-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <PhoneIcon />
          </div>
          <h1 className="text-xl font-bold text-white">Blue Bayou</h1>
          <p className="text-sm text-white/80 mt-1 tracking-widest uppercase">Reception Portal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">

          {/* Session-terminated banner (deactivated / access revoked) */}
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

          {/* Error banners — distinct per type */}
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
                <p className="text-sm font-semibold text-orange-800">No reception access</p>
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

      <p className="mt-6 text-sm text-white/60">
        Contact your administrator if you need access.
      </p>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-8 h-8 shrink-0 mt-0.5">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l1.62-1.62a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
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
