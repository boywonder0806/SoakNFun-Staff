import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../lib/api.js';

export default function ChangePassword() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm)  { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/auth/change-password', { password });
      updateUser(data.token, data.user);
      navigate(data.user.role === 'manager' || data.user.role === 'sysadmin' ? '/scheduler' : '/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-4 relative overflow-hidden">

      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-cyan/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-navy/60 blur-[120px] pointer-events-none" />

      <div className="mb-10 text-center relative z-10">
        <div className="w-24 h-24 mx-auto flex items-center justify-center">
          <img src="/images/BlueBayou_bv.png" alt="Blue Bayou" className="w-full h-full object-contain" />
        </div>
        <p className="mt-3 text-sm font-bold tracking-widest uppercase text-white">Staff Portal</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm relative z-10">
        <div className="panel p-8 space-y-5">
          <div>
            <h2 className="font-heading font-black text-ink text-xl leading-none mb-1">Set Your Password</h2>
            <p className="text-xs text-fog">
              Welcome, {user?.name?.split(' ')[0]}. Please set a permanent password before continuing.
            </p>
          </div>

          <div>
            <label className="label-xs block mb-2">New Password</label>
            <input
              type="password"
              className="field"
              placeholder="Min. 6 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="label-xs block mb-2">Confirm Password</label>
            <input
              type="password"
              className="field"
              placeholder="Re-enter password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-red-400 text-xs font-semibold">{error}</p>}

          <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
            {saving ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
