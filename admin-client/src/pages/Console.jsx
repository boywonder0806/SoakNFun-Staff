import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import api from '../lib/api.js';
import ApiManagement from './ApiManagement.jsx';

const ROLES = [
  { value: 'crew_member', label: 'Staff' },
  { value: 'manager',     label: 'Manager' },
  { value: 'sysadmin',    label: 'System Administrator' },
];

const ROLE_BADGES = {
  sysadmin:    'bg-orange-50 text-orange-700 border-orange-200',
  manager:     'bg-blue-50 text-blue-700 border-blue-200',
  crew_member: 'bg-gray-50 text-gray-600 border-gray-200',
};

// Tool access definitions — { key: user field, tool: API tool name }
const TOOLS = [
  { key: 'hasStaffAccess',     tool: 'staff',             label: 'Staff Portal',      badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { key: 'hasHrAccess',        tool: 'hr',                label: 'HR Portal',         badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  { key: 'isHrManager',        tool: 'hr_manager',        label: 'HR Manager',        badge: 'bg-teal-50 text-teal-800 border-teal-300' },
  { key: 'hasReceptionAccess', tool: 'reception',         label: 'Reception',         badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'isReceptionManager', tool: 'reception_manager', label: 'Reception Manager', badge: 'bg-amber-50 text-amber-800 border-amber-300' },
  { key: 'hasBotAccess',       tool: 'bot',               label: 'BayouBot',          badge: 'bg-violet-50 text-violet-700 border-violet-200' },
];

export default function Console() {
  const { user: me } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [profileId, setProfileId]   = useState(null);
  const [tab, setTab]         = useState('users');
  const [toast, setToast]     = useState(null);
  const toastTimer = useRef(null);

  function notify(msg, isError = false) {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    api.get('/admin/sysadmin/users')
      .then(r => setUsers(r.data.users))
      .catch(err => setError(err.response?.data?.error || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.position?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search, roleFilter]);

  const stats = useMemo(() => ({
    total:    users.length,
    admins:   users.filter(u => u.role === 'sysadmin').length,
    managers: users.filter(u => u.role === 'manager').length,
    locked:   users.filter(u => u.isLocked).length,
  }), [users]);

  function patchLocal(id, patch) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  }

  async function toggleAccess(u, toolDef) {
    const next = !u[toolDef.key];
    patchLocal(u.id, { [toolDef.key]: next });
    try {
      await api.patch(`/admin/sysadmin/users/${u.id}/access`, { tool: toolDef.tool, access: next });
      notify(`${toolDef.label} access ${next ? 'granted to' : 'removed from'} ${u.name}`);
    } catch (err) {
      patchLocal(u.id, { [toolDef.key]: !next });
      notify(err.response?.data?.error || 'Failed to update access', true);
    }
  }

  async function changeRole(u, role) {
    const prev = u.role;
    patchLocal(u.id, { role });
    try {
      await api.patch(`/admin/employees/${u.id}/role`, { role });
      notify(`${u.name} is now ${ROLES.find(r => r.value === role)?.label || role}`);
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
      notify(`${u.name}'s account has been ${next ? 'locked' : 'unlocked'}`);
    } catch (err) {
      patchLocal(u.id, { isLocked: !next });
      notify(err.response?.data?.error || 'Failed to update account lock', true);
    }
  }

  async function sendReset(u) {
    try {
      await api.post(`/admin/employees/${u.id}/send-password-reset`);
      notify(`Password reset email sent to ${u.email}`);
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to send password reset email', true);
    }
  }

  async function resendWelcome(u) {
    try {
      await api.post(`/admin/sysadmin/users/${u.id}/resend-welcome`);
      notify(`Welcome email sent to ${u.email}`);
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to send welcome email', true);
    }
  }

  // Throws on failure so the confirmation modal can show the error inline.
  async function deleteUser(u, confirmEmail) {
    await api.delete(`/admin/employees/${u.id}`, { data: { confirmEmail } });
    setUsers(prev => prev.filter(x => x.id !== u.id));
    setProfileId(null);
    notify(`${u.name}'s account has been permanently deleted`);
  }

  function handleCreated(newUser) {
    setUsers(prev => [...prev, {
      ...newUser,
      hasStaffAccess: false, hasHrAccess: false, isHrManager: false,
      hasReceptionAccess: false, isReceptionManager: false,
      hasBotAccess: false, isLocked: false,
    }].sort((a, b) => a.name.localeCompare(b.name)));
    setShowCreate(false);
    notify(`Account created for ${newUser.name} — welcome email sent`);
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="w-64 shrink-0 flex flex-col text-white"
        style={{ background: 'linear-gradient(180deg, #1c1310 0%, #140d0a 100%)' }}
      >
        {/* Brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #c2410c, #ea580c)', boxShadow: '0 4px 14px rgba(234,88,12,0.35)' }}>
              <ShieldIcon />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-orange-400/90 leading-none mb-1">Blue Bayou</p>
              <h1 className="text-base font-bold text-white leading-none">Admin Console</h1>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest px-3 mb-2">Administration</p>
          {[
            { id: 'users', label: 'User Management', Icon: UsersNavIcon },
            { id: 'api',   label: 'API Management',  Icon: PlugIcon },
          ].map(({ id, label, Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left
                  ${isActive ? 'text-white bg-white/[0.06]' : 'text-stone-400 hover:bg-white/[0.04] hover:text-white'}`}
                style={isActive ? { boxShadow: 'inset 0 0 0 1px rgba(251,146,60,0.25)' } : {}}
              >
                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-orange-400" />}
                <span className={isActive ? 'text-orange-400' : ''}><Icon /></span>
                {label}
              </button>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-orange-300 shrink-0 border border-orange-500/30"
              style={{ background: 'rgba(234,88,12,0.12)' }}>
              {me?.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{me?.name}</p>
              <p className="text-xs text-stone-500 truncate">System Administrator</p>
            </div>
          </div>
          <button
            onClick={() => { window.location.href = hubUrl(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-stone-500 hover:bg-white/[0.04] hover:text-white rounded-lg transition-colors"
          >
            <HomeIcon /> Return Home
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Page header */}
        <div className="bg-white/80 backdrop-blur border-b border-gray-200 px-8 py-4 shrink-0 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{tab === 'users' ? 'User Management' : 'API Management'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {tab === 'users'
                ? 'Accounts, roles, and tool access across the staff platform'
                : 'Live status and billing for every external service the platform depends on'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-xs text-gray-400 font-medium hidden md:block">{today}</p>
            {tab === 'users' && (
              <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-4 py-2.5">
                <PlusIcon /> New User
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'api' ? <ApiManagement /> : (
          <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fade-up">
              <Stat label="Total Users" value={stats.total} />
              <Stat label="System Administrators" value={stats.admins} accent />
              <Stat label="Managers" value={stats.managers} />
              <Stat label="Locked Accounts" value={stats.locked} warn={stats.locked > 0} />
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <SearchIcon />
                <input
                  type="text"
                  placeholder="Search by name, email, or position…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="field pl-9"
                />
              </div>
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                className="field w-auto text-sm py-2.5"
              >
                <option value="all">All Roles</option>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            {/* Users */}
            {loading ? (
              <div className="flex items-center justify-center h-48 bg-white rounded-2xl border border-gray-200">
                <div className="w-6 h-6 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-sm text-red-600">{error}</div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {/* Column headers */}
                <div className="hidden md:grid px-6 py-3 border-b border-gray-100 bg-gray-50/70 text-xs font-semibold text-gray-400 uppercase tracking-wide items-center"
                  style={{ gridTemplateColumns: 'minmax(240px, 1.1fr) 150px 1fr 110px 32px' }}>
                  <span>User</span>
                  <span>Role</span>
                  <span>Tool Access</span>
                  <span>Status</span>
                  <span />
                </div>

                <div className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <p className="text-center py-14 text-sm text-gray-400">
                      {users.length === 0 ? 'No user accounts yet.' : 'No users match your search.'}
                    </p>
                  ) : filtered.map(u => (
                    <UserRow key={u.id} user={u} isSelf={u.id === me?.id} onOpen={() => setProfileId(u.id)} />
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 text-center pb-4">
              Select a user to manage their access, role, and account. Changes take effect on the user's next sign-in or page refresh.
            </p>
          </div>
          )}
        </div>
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
          onDelete={deleteUser}
        />
      )}
    </div>
  );
}

// ── User row (read-only — editing happens in the profile drawer) ─────────────

function UserRow({ user: u, isSelf, onOpen }) {
  const initials = u.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
  const granted = TOOLS.filter(t => u[t.key]);
  const role = ROLES.find(r => r.value === u.role);

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left md:grid flex flex-col gap-3 px-6 py-4 items-center transition-colors
        ${u.isLocked ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50/70'}`}
      style={{ gridTemplateColumns: 'minmax(240px, 1.1fr) 150px 1fr 110px 32px' }}
    >
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0 w-full md:w-auto">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0
          ${u.isLocked ? 'bg-red-100 text-red-600' : 'bg-admin/10 text-admin'}`}>
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
            {u.name}
            {isSelf && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200">You</span>}
          </p>
          <p className="text-xs text-gray-400 truncate">{u.email}{u.position ? ` · ${u.position}` : ''}</p>
        </div>
      </div>

      {/* Role */}
      <div>
        <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg border ${ROLE_BADGES[u.role] || ROLE_BADGES.crew_member}`}>
          {role?.label || u.role}
        </span>
      </div>

      {/* Tool access summary */}
      <div className="flex flex-wrap gap-1.5">
        {granted.length === 0 ? (
          <span className="text-xs text-gray-300">No tools assigned</span>
        ) : granted.map(t => (
          <span key={t.tool} className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${t.badge}`}>
            {t.label}
          </span>
        ))}
      </div>

      {/* Status */}
      <div>
        {u.isLocked ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Locked
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
          </span>
        )}
      </div>

      {/* Chevron */}
      <div className="hidden md:flex justify-end text-gray-300">
        <ChevronIcon />
      </div>
    </button>
  );
}

// ── Profile drawer ────────────────────────────────────────────────────────────

function ProfileDrawer({ user: u, isSelf, onClose, onToggleAccess, onChangeRole, onToggleLock, onSendReset, onResendWelcome, onDelete }) {
  const [detail, setDetail] = useState(null);
  const [logs, setLogs]     = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
              <CloseIcon />
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
                <DetailField label="Hire Date"  value={fmtD(detail.hireDate)} />
                <DetailField label="Account Created" value={fmtD(detail.createdAt)} />
                <DetailField label="Status" value={
                  detail.isActive
                    ? (detail.mustChangePassword ? 'Active — password change required' : 'Active')
                    : 'Deactivated'
                } />
              </div>
            )}
          </div>

          {/* Access */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="label mb-1">Tool Access</p>
            <p className="text-[11px] text-gray-400 mb-3">Click a tool to grant or remove access. Changes apply on the user's next sign-in.</p>
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
            <p className="label mb-3">Account Actions</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Role</label>
                <select
                  value={u.role}
                  disabled={isSelf}
                  onChange={e => onChangeRole(u, e.target.value)}
                  className="field text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <button onClick={() => onToggleLock(u)} disabled={isSelf}
                className={`text-xs font-semibold px-3 py-2.5 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                  ${u.isLocked
                    ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {u.isLocked ? 'Unlock Account' : 'Lock Account'}
              </button>
              <button onClick={() => onSendReset(u)} className="btn-ghost text-xs py-2.5">
                Send Password Reset
              </button>
              <button onClick={() => onResendWelcome(u)} className="btn-ghost text-xs py-2.5 col-span-2">
                Resend Welcome Email
              </button>
            </div>
          </div>

          {/* Danger zone */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="label mb-1 text-red-500">Danger Zone</p>
            <p className="text-[11px] text-gray-400 mb-3">
              Permanently deletes this account along with their shifts, timecards, time-off history, and certifications. This cannot be undone.
            </p>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isSelf}
              className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Account
            </button>
          </div>

          {/* Activity log */}
          <div className="px-6 py-5">
            <p className="label mb-3">Account Activity <span className="normal-case font-normal text-gray-400">(most recent 50 events)</span></p>
            {logs === null ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
              </div>
            ) : logs === false ? (
              <p className="text-xs text-red-500">Could not load account activity.</p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-6 text-center">No activity recorded yet.</p>
            ) : (
              <div className="relative pl-4">
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-200" />
                <div className="space-y-4">
                  {logs.map(l => (
                    <div key={l.id} className="relative">
                      <span className={`absolute -left-4 top-1 w-[11px] h-[11px] rounded-full border-2 border-white
                        ${/lock|revoked|removed|deactivat/i.test(l.event) ? 'bg-red-400'
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

      {confirmDelete && (
        <DeleteConfirmModal
          user={u}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={email => onDelete(u, email)}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({ user: u, onCancel, onConfirm }) {
  const [value, setValue]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const matches = value.trim().toLowerCase() === u.email.toLowerCase();

  async function handleConfirm() {
    if (!matches) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm(value.trim());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete account');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 bg-red-600">
          <h2 className="text-base font-bold text-white">Delete {u.name}'s Account?</h2>
          <p className="text-xs text-white/80 mt-1">
            This permanently removes their login, shifts, timecards, time-off history, and certifications. It cannot be undone.
          </p>
        </div>
        <div className="p-6 space-y-3">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          <label className="label">
            Type <span className="font-mono text-gray-700">{u.email}</span> to confirm
          </label>
          <input
            className="field"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={u.email}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={onCancel} disabled={saving} className="btn-ghost text-xs py-2.5">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!matches || saving}
              className="text-xs font-semibold py-2.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Deleting…' : 'Delete Permanently'}
            </button>
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

// ── Create user modal ─────────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }) {
  const backdropRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'manager', position: '', phone: '' });
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
      setError(err.response?.data?.error || 'Failed to create the account');
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
          <div>
            <h2 className="text-base font-bold text-white">New User Account</h2>
            <p className="text-xs text-white/70 mt-0.5">A welcome email with a password setup link is sent automatically</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          <div>
            <label className="label">Full Name</label>
            <input className="field" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" />
          </div>
          <div>
            <label className="label">Email Address</label>
            <input className="field" type="email" required value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@bluebayou.com" />
          </div>
          <div>
            <label className="label">Phone Number</label>
            <input className="field" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Optional" />
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
            {saving ? 'Creating account…' : 'Create Account'}
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            New accounts start with no tool access — grant tools from the user's profile after creation.
          </p>
        </form>
      </div>
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent, warn }) {
  return (
    <div className={`bg-white rounded-2xl border p-5 ${warn ? 'border-red-200' : accent ? 'border-admin/30' : 'border-gray-200'}`}>
      <p className={`text-2xl font-bold ${warn ? 'text-red-600' : accent ? 'text-admin' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1.5 font-medium">{label}</p>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UsersNavIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <path d="M18 8V5a1 1 0 0 0-1-1h-2" />
      <path d="M9 4H7a1 1 0 0 0-1 1v3" />
      <path d="M4 8h16v4a8 8 0 0 1-16 0V8z" transform="rotate(180 12 13)" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8z" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
