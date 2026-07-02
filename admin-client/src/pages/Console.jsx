import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../lib/api.js';

const ROLES = [
  { value: 'crew_member', label: 'Staff' },
  { value: 'manager',     label: 'Manager' },
  { value: 'sysadmin',    label: 'Sysadmin' },
];

const ROLE_COLORS = {
  sysadmin:    'bg-orange-100 text-orange-700',
  manager:     'bg-blue-100 text-blue-700',
  crew_member: 'bg-gray-100 text-gray-600',
};

// Tool access toggles — { key: user field, tool: API tool name }
const TOOLS = [
  { key: 'hasStaffAccess',      tool: 'staff',             label: 'Staff Portal' },
  { key: 'hasHrAccess',         tool: 'hr',                label: 'HR' },
  { key: 'isHrManager',         tool: 'hr_manager',        label: 'HR Mgr' },
  { key: 'hasReceptionAccess',  tool: 'reception',         label: 'Reception' },
  { key: 'isReceptionManager',  tool: 'reception_manager', label: 'Rec Mgr' },
  { key: 'hasBotAccess',        tool: 'bot',               label: 'BayouBot' },
];

export default function Console() {
  const { user: me, logout } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [profileId, setProfileId]   = useState(null);
  const [toast, setToast]     = useState(null);
  const toastTimer = useRef(null);

  function notify(msg, isError = false) {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    api.get('/admin/sysadmin/users')
      .then(r => setUsers(r.data.users))
      .catch(err => setError(err.response?.data?.error || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.position?.toLowerCase().includes(q)
    );
  }, [users, search]);

  const stats = useMemo(() => ({
    total:    users.length,
    admins:   users.filter(u => u.role === 'sysadmin').length,
    locked:   users.filter(u => u.isLocked).length,
    staff:    users.filter(u => u.hasStaffAccess).length,
    hr:       users.filter(u => u.hasHrAccess).length,
    reception: users.filter(u => u.hasReceptionAccess).length,
    bot:      users.filter(u => u.hasBotAccess).length,
  }), [users]);

  function patchLocal(id, patch) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  }

  async function toggleAccess(u, toolDef) {
    const next = !u[toolDef.key];
    patchLocal(u.id, { [toolDef.key]: next }); // optimistic
    try {
      await api.patch(`/admin/sysadmin/users/${u.id}/access`, { tool: toolDef.tool, access: next });
      notify(`${toolDef.label} access ${next ? 'granted to' : 'revoked from'} ${u.name}`);
    } catch (err) {
      patchLocal(u.id, { [toolDef.key]: !next }); // revert
      notify(err.response?.data?.error || 'Failed to update access', true);
    }
  }

  async function changeRole(u, role) {
    const prev = u.role;
    patchLocal(u.id, { role });
    try {
      await api.patch(`/admin/employees/${u.id}/role`, { role });
      notify(`${u.name} is now ${role}`);
    } catch (err) {
      patchLocal(u.id, { role: prev });
      notify(err.response?.data?.error || 'Failed to change role', true);
    }
  }

  async function toggleLock(u) {
    const next = !u.isLocked;
    patchLocal(u.id, { isLocked: next });
    try {
      await api.patch(`/admin/employees/${u.id}/lock`, { locked: next });
      notify(`${u.name}'s account ${next ? 'locked' : 'unlocked'}`);
    } catch (err) {
      patchLocal(u.id, { isLocked: !next });
      notify(err.response?.data?.error || 'Failed to update lock', true);
    }
  }

  async function sendReset(u) {
    try {
      await api.post(`/admin/employees/${u.id}/send-password-reset`);
      notify(`Password reset email sent to ${u.email}`);
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to send reset email', true);
    }
  }

  async function resendWelcome(u) {
    try {
      await api.post(`/admin/sysadmin/users/${u.id}/resend-welcome`);
      notify(`Welcome email resent to ${u.email}`);
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to resend welcome email', true);
    }
  }

  function handleCreated(newUser) {
    setUsers(prev => [...prev, {
      ...newUser,
      hasHrAccess: false, isHrManager: false,
      hasReceptionAccess: false, isReceptionManager: false,
      hasBotAccess: false, isLocked: false,
    }].sort((a, b) => a.name.localeCompare(b.name)));
    setShowCreate(false);
    notify(`${newUser.name} created — welcome email sent`);
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center gap-3 sticky top-0 z-20">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #c2410c, #ea580c)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}>
          <ShieldIcon />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-bold tracking-widest uppercase text-admin leading-none mb-1">Blue Bayou</p>
          <h1 className="text-sm font-bold text-gray-900 leading-none">Admin Console</h1>
        </div>
        <span className="text-xs text-gray-400 hidden sm:block">{me?.name}</span>
        <button onClick={logout} className="btn-ghost text-xs py-2">Sign Out</button>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 animate-fade-up">
          <Stat label="Users" value={stats.total} />
          <Stat label="Sysadmins" value={stats.admins} accent />
          <Stat label="Staff Portal" value={stats.staff} />
          <Stat label="HR Access" value={stats.hr} />
          <Stat label="Reception" value={stats.reception} />
          <Stat label="BayouBot" value={stats.bot} />
          <Stat label="Locked" value={stats.locked} warn={stats.locked > 0} />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search by name, email, or position…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field pl-9"
            />
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-4 py-2.5 whitespace-nowrap">
            + New User
          </button>
        </div>

        {/* Users table */}
        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-2xl border border-gray-200">
            <div className="w-6 h-6 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-sm text-red-600">{error}</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="hidden md:grid px-5 py-2.5 border-b border-gray-100 bg-gray-50/70 text-xs font-semibold text-gray-400 uppercase tracking-wide"
              style={{ gridTemplateColumns: 'minmax(220px,1.2fr) 110px 1fr 170px' }}>
              <span>User</span>
              <span>Role</span>
              <span>Tool Access</span>
              <span className="text-right">Actions</span>
            </div>

            <div className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <p className="text-center py-12 text-sm text-gray-400">No users match your search.</p>
              ) : filtered.map(u => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.id === me?.id}
                  onOpen={() => setProfileId(u.id)}
                  onToggleAccess={toggleAccess}
                  onChangeRole={changeRole}
                  onToggleLock={toggleLock}
                  onSendReset={sendReset}
                  onResendWelcome={resendWelcome}
                />
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pb-4">
          Access changes take effect on the user's next sign-in or page refresh.
        </p>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl animate-fade-up
          ${toast.isError ? 'bg-red-600' : 'bg-gray-900'}`}>
          {toast.msg}
        </div>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}

      {profileId && (
        <ProfileDrawer
          user={users.find(u => u.id === profileId)}
          isSelf={profileId === me?.id}
          onClose={() => setProfileId(null)}
          onToggleAccess={toggleAccess}
          onChangeRole={changeRole}
          onToggleLock={toggleLock}
          onSendReset={sendReset}
          onResendWelcome={resendWelcome}
        />
      )}
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user: u, isSelf, onOpen, onToggleAccess, onChangeRole, onToggleLock, onSendReset, onResendWelcome }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const initials = u.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div className={`md:grid px-5 py-4 items-center gap-3 flex flex-col md:flex-row ${u.isLocked ? 'bg-red-50/40' : 'hover:bg-gray-50/60'} transition-colors`}
      style={{ gridTemplateColumns: 'minmax(220px,1.2fr) 110px 1fr 170px' }}>

      {/* Identity — click to open the full profile */}
      <button onClick={onOpen} className="flex items-center gap-3 min-w-0 w-full md:w-auto text-left group/id">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0
          ${u.isLocked ? 'bg-red-100 text-red-600' : 'bg-admin/10 text-admin'}`}>
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
            {u.name}
            {isSelf && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">you</span>}
            {u.isLocked && <LockIcon />}
          </p>
          <p className="text-xs text-gray-400 truncate group-hover/id:text-admin transition-colors">{u.email}{u.position ? ` · ${u.position}` : ''}</p>
        </div>
      </button>

      {/* Role */}
      <div>
        <select
          value={u.role}
          disabled={isSelf}
          onChange={e => onChangeRole(u, e.target.value)}
          className={`text-xs font-semibold rounded-lg px-2 py-1.5 border-0 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-admin/30
            ${ROLE_COLORS[u.role] || ROLE_COLORS.crew_member}`}
        >
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Tool access pills */}
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map(t => {
          const on = !!u[t.key];
          return (
            <button
              key={t.tool}
              onClick={() => onToggleAccess(u, t)}
              title={`${on ? 'Revoke' : 'Grant'} ${t.label} access`}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all active:scale-95
                ${on
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'}`}
            >
              {t.label}{on ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 relative w-full md:w-auto" ref={menuRef}>
        <button
          onClick={() => onToggleLock(u)}
          disabled={isSelf}
          className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
            ${u.isLocked
              ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
        >
          {u.isLocked ? 'Unlock' : 'Lock'}
        </button>
        <button
          onClick={() => setMenuOpen(p => !p)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-30 overflow-hidden py-1">
            <button onClick={() => { setMenuOpen(false); onSendReset(u); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50">
              Send password reset email
            </button>
            <button onClick={() => { setMenuOpen(false); onResendWelcome(u); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50">
              Resend welcome email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create user modal ─────────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }) {
  const backdropRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'manager', position: '', phone: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data } = await api.post('/admin/sysadmin/users', form);
      onCreated(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={backdropRef} onClick={e => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #7c2d12, #ea580c)' }}>
          <h2 className="text-base font-bold text-white">New User</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          <div>
            <label className="label">Full Name</label>
            <input className="field" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="field" type="email" required value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@bluebayou.com" />
          </div>
          <div>
            <label className="label">Temporary Password</label>
            <input className="field" required minLength={6} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Sent in the welcome email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role</label>
              <select className="field" value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Position</label>
              <input className="field" value={form.position} onChange={e => set('position', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full py-2.5">
            {saving ? 'Creating…' : 'Create User & Send Welcome Email'}
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            Grant tool access from the console after creating the account.
          </p>
        </form>
      </div>
    </div>
  );
}


// ── Profile drawer ────────────────────────────────────────────────────────────

function ProfileDrawer({ user: u, isSelf, onClose, onToggleAccess, onChangeRole, onToggleLock, onSendReset, onResendWelcome }) {
  const [detail, setDetail] = useState(null);
  const [logs, setLogs]     = useState(null);

  useEffect(() => {
    if (!u?.id) return;
    setDetail(null);
    setLogs(null);
    api.get(`/admin/sysadmin/users/${u.id}`).then(r => setDetail(r.data.user)).catch(() => setDetail(false));
    api.get(`/admin/staff/${u.id}/logs`).then(r => setLogs(r.data.logs)).catch(() => setLogs(false));
  }, [u?.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!u) return null;
  const initials = u.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';

  const fmtDT = iso => iso ? new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : '—';
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  }) : '—';

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={e => e.target === e.currentTarget && onClose()}
      style={{ background: 'rgba(15, 23, 42, 0.35)', backdropFilter: 'blur(2px)' }}>

      <div className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col animate-drawer-in overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-5 shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 60%, #ea580c 100%)' }}>
          <div className="flex items-start justify-between mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-lg font-bold text-white"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}>
              {initials}
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-white">{u.name}</h2>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/20 text-white">
              {ROLES.find(r => r.value === u.role)?.label || u.role}
            </span>
            {u.isLocked && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/90 text-white">Locked</span>
            )}
          </div>
          <p className="text-sm text-white/75 mt-1">{u.email}</p>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Details */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="label mb-3">Account Details</p>
            {detail === null ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
              </div>
            ) : detail === false ? (
              <p className="text-xs text-red-500">Could not load account details.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailField label="Position"   value={detail.position || '—'} />
                <DetailField label="Phone"      value={detail.phone || '—'} />
                <DetailField label="Department" value={(detail.departments?.length ? detail.departments.join(', ') : detail.department) || '—'} />
                <DetailField label="Hired"      value={fmtD(detail.hireDate)} />
                <DetailField label="Account created" value={fmtD(detail.createdAt)} />
                <DetailField label="Status" value={
                  detail.isActive
                    ? (detail.mustChangePassword ? 'Active — must change password' : 'Active')
                    : 'Deactivated'
                } />
              </div>
            )}
          </div>

          {/* Access */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="label mb-3">Tool Access</p>
            <div className="flex flex-wrap gap-2">
              {TOOLS.map(t => {
                const on = !!u[t.key];
                return (
                  <button
                    key={t.tool}
                    onClick={() => onToggleAccess(u, t)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all active:scale-95
                      ${on
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'}`}
                  >
                    {t.label}{on ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="label mb-3">Actions</p>
            <div className="flex flex-wrap gap-2">
              <select
                value={u.role}
                disabled={isSelf}
                onChange={e => onChangeRole(u, e.target.value)}
                className={`text-xs font-semibold rounded-lg px-2.5 py-2 border-0 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-admin/30
                  ${ROLE_COLORS[u.role] || ROLE_COLORS.crew_member}`}
              >
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button onClick={() => onToggleLock(u)} disabled={isSelf}
                className="btn-ghost text-xs py-2 disabled:opacity-40">
                {u.isLocked ? 'Unlock account' : 'Lock account'}
              </button>
              <button onClick={() => onSendReset(u)} className="btn-ghost text-xs py-2">
                Send password reset
              </button>
              <button onClick={() => onResendWelcome(u)} className="btn-ghost text-xs py-2">
                Resend welcome
              </button>
            </div>
          </div>

          {/* Activity log */}
          <div className="px-6 py-5">
            <p className="label mb-3">Account Activity <span className="normal-case font-normal text-gray-400">(last 50 events)</span></p>
            {logs === null ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
              </div>
            ) : logs === false ? (
              <p className="text-xs text-red-500">Could not load activity.</p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-6 text-center">No activity recorded yet.</p>
            ) : (
              <div className="relative pl-4">
                {/* Timeline rail */}
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-200" />
                <div className="space-y-4">
                  {logs.map(l => (
                    <div key={l.id} className="relative">
                      <span className={`absolute -left-4 top-1 w-[11px] h-[11px] rounded-full border-2 border-white
                        ${/lock|revoked|deactivat/i.test(l.event) ? 'bg-red-400'
                          : /granted|created|welcome/i.test(l.event) ? 'bg-emerald-400'
                          : /login/i.test(l.event) ? 'bg-sky-400' : 'bg-gray-300'}`}
                        style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }} />
                      <p className="text-xs font-semibold text-gray-800">{l.event}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {fmtDT(l.createdAt)}
                        {l.actorName && ` · by ${l.actorName}`}
                        {l.ipAddress && ` · ${l.ipAddress}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent, warn }) {
  return (
    <div className={`bg-white rounded-2xl border p-4 ${warn ? 'border-red-200' : accent ? 'border-admin/30' : 'border-gray-200'}`}>
      <p className={`text-xl font-bold ${warn ? 'text-red-600' : accent ? 'text-admin' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-1 font-medium">{label}</p>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5" style={{ width: 18, height: 18 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 text-red-500 shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
