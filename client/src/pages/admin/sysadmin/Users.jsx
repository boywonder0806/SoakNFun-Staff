import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';

export const ROLES = [
  { value: 'crew_member', label: 'Crew Member',         style: 'bg-rim/40 border-rim text-fog-hi',       active: 'bg-shell border-fog-hi/40 text-ink'  },
  { value: 'manager',     label: 'Manager',              style: 'bg-cyan/10 border-cyan/20 text-cyan',     active: 'bg-cyan/15 border-cyan/40 text-cyan'  },
  { value: 'sysadmin',    label: 'System Administrator', style: 'bg-gold/10 border-gold/25 text-gold',     active: 'bg-gold/15 border-gold/40 text-gold'  },
];

export default function SysAdminUsers() {
  const { user: me } = useAuth();
  const [staff, setStaff]       = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch]     = useState('');

  useEffect(() => {
    api.get('/admin/sysadmin/users')
      .then(r => setStaff(r.data.users))
      .catch(console.error);
  }, []);

  function handleRoleUpdate(userId, newRole) {
    setStaff(prev => prev.map(s => s.id === userId ? { ...s, role: newRole } : s));
    if (selected?.id === userId) setSelected(s => ({ ...s, role: newRole }));
  }

  function handleUserUpdate(userId, updates) {
    setStaff(prev => prev.map(s => s.id === userId ? { ...s, ...updates } : s));
    setSelected(s => s?.id === userId ? { ...s, ...updates } : s);
  }

  function handleLockUpdate(userId, isLocked) {
    setStaff(prev => prev.map(s => s.id === userId ? { ...s, isLocked } : s));
    setSelected(s => s?.id === userId ? { ...s, isLocked } : s);
  }

  function handleReceptionUpdate(userId, hasReceptionAccess) {
    setStaff(prev => prev.map(s => s.id === userId ? { ...s, hasReceptionAccess } : s));
    setSelected(s => s?.id === userId ? { ...s, hasReceptionAccess } : s);
  }

  const visible = search
    ? staff.filter(s => {
        const q = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.position?.toLowerCase().includes(q)
        );
      })
    : staff;

  return (
    <div className="flex flex-col gap-5" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Header */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <p className="label-xs mb-1">System Admin / Users</p>
          <h1 className="font-heading font-black text-ink text-3xl leading-none uppercase tracking-tight">
            User Management
          </h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2 text-xs"
          >
            <PlusIcon /> New User
          </button>
        </div>
      </div>

      {/* Content — full width user list */}
      <div className="flex-1 min-h-0">
        <div className="panel p-5 h-full flex flex-col gap-4 min-h-0">

          {/* Search */}
          <div className="relative shrink-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fog pointer-events-none">
              <SearchIcon />
            </span>
            <input
              type="text"
              className="field pl-9 pr-9 text-sm w-full"
              placeholder="Search by name, email, or position…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fog hover:text-ink transition-colors"
              >
                <XIcon />
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-rim/40 shrink-0" />

          {/* User list */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <p className="text-fog text-sm">No users match your search.</p>
                <button onClick={() => setSearch('')} className="text-10 font-bold tracking-widest uppercase text-cyan hover:text-cyan-light transition-colors">
                  Clear
                </button>
              </div>
            ) : (
              visible.map(s => {
                const role = ROLES.find(r => r.value === s.role) ?? ROLES[0];
                const isSelf = s.id === me?.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className="w-full flex items-center gap-4 bg-shell/40 hover:bg-shell border border-rim/40 hover:border-rim/80 rounded-xl px-4 py-3 text-left transition-all group"
                  >
                    <div className="w-10 h-10 rounded-full bg-shell border border-rim flex items-center justify-center text-sm font-heading font-bold text-fog-hi shrink-0 overflow-hidden">
                      {s.photoUrl
                        ? <img src={s.photoUrl} className="w-full h-full object-cover" alt={s.name} />
                        : s.avatar
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink truncate">{s.name}</p>
                        {isSelf && <span className="text-10 text-fog">(you)</span>}
                      </div>
                      <p className="text-10 text-fog mt-0.5">{s.position} · {s.department}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-2 justify-end">
                        <span className={`text-10 font-bold tracking-widests uppercase px-2.5 py-1 rounded-full border ${role.style}`}>
                          {role.label}
                        </span>
                        {s.isLocked && (
                          <span title="Account locked" className="text-amber-400">
                            <RowLockIcon />
                          </span>
                        )}
                      </div>
                      <p className="text-10 text-fog mt-1.5">{s.email}</p>
                    </div>
                    <span className="text-fog/30 group-hover:text-fog transition-colors ml-1">
                      <ChevronIcon />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* User modal */}
      {selected && (
        <UserModal
          user={selected}
          isSelf={selected.id === me?.id}
          onClose={() => setSelected(null)}
          onRoleUpdate={handleRoleUpdate}
          onUserUpdate={handleUserUpdate}
          onLockUpdate={handleLockUpdate}
          onReceptionUpdate={handleReceptionUpdate}
        />
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={u => { setStaff(prev => [...prev, u].sort((a, b) => a.name.localeCompare(b.name))); setCreating(false); }}
        />
      )}
    </div>
  );
}

const ALL_DEPARTMENTS = ['Aquatics', 'Guest Services', 'Food & Beverage', 'Cleaning Crew'];

const DEPT_STYLE = {
  'Aquatics':        { active: 'bg-aq/15 border-aq/40 text-aq',     inactive: 'border-rim/50 text-fog hover:border-aq/30 hover:text-aq'     },
  'Guest Services':  { active: 'bg-gs/15 border-gs/40 text-gs',     inactive: 'border-rim/50 text-fog hover:border-gs/30 hover:text-gs'     },
  'Food & Beverage': { active: 'bg-fb/15 border-fb/40 text-fb',     inactive: 'border-rim/50 text-fog hover:border-fb/30 hover:text-fb'     },
  'Cleaning Crew':   { active: 'bg-cc/15 border-cc/40 text-cc',     inactive: 'border-rim/50 text-fog hover:border-cc/30 hover:text-cc'     },
};

// ── User Modal ────────────────────────────────────────────────────────────────
function UserModal({ user, isSelf, onClose, onRoleUpdate, onUserUpdate, onLockUpdate, onReceptionUpdate }) {
  const navigate       = useNavigate();
  const backdropRef    = useRef(null);
  const photoInputRef  = useRef(null);

  const [saving, setSaving]                 = useState(false);
  const [deptSaving, setDeptSaving]         = useState(false);
  const [activeDepts, setActiveDepts]       = useState(user.departments ?? [user.department]);
  const [pwMode, setPwMode]                 = useState(false);
  const [newPassword, setNewPassword]       = useState('');
  const [pwError, setPwError]               = useState('');
  const [pwSuccess, setPwSuccess]           = useState(false);
  const [deactivateStep, setDeactivateStep] = useState(false);

  const [editMode, setEditMode]   = useState(false);
  const [editForm, setEditForm]   = useState({ name: user.name, email: user.email, phone: user.phone ?? '', position: user.position ?? '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError]   = useState('');

  const [photoUploading, setPhotoUploading]       = useState(false);
  const [lockSaving, setLockSaving]               = useState(false);
  const [receptionSaving, setReceptionSaving]     = useState(false);

  const role = ROLES.find(r => r.value === user.role) ?? ROLES[0];

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleRoleChange(newRole) {
    if (newRole === user.role || isSelf) return;
    setSaving(true);
    try {
      await api.patch(`/admin/employees/${user.id}/role`, { role: newRole });
      onRoleUpdate(user.id, newRole);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeptToggle(dept) {
    const isManager = user.role === 'manager' || user.role === 'sysadmin';
    let next;
    if (activeDepts.includes(dept)) {
      if (!isManager && (dept === user.department || activeDepts.length === 1)) return;
      next = activeDepts.filter(d => d !== dept);
    } else {
      next = [...activeDepts, dept];
    }
    setActiveDepts(next);
    setDeptSaving(true);
    try {
      await api.patch(`/admin/employees/${user.id}/departments`, { departments: next });
    } catch (err) {
      setActiveDepts(activeDepts);
      console.error(err);
    } finally {
      setDeptSaving(false);
    }
  }

  async function handlePasswordReset() {
    setPwError('');
    if (newPassword.length < 6) { setPwError('Minimum 6 characters.'); return; }
    setSaving(true);
    try {
      await api.patch(`/admin/employees/${user.id}/password`, { password: newPassword });
      setPwSuccess(true);
      setNewPassword('');
      setTimeout(() => { setPwSuccess(false); setPwMode(false); }, 2000);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to reset password.');
    } finally {
      setSaving(false);
    }
  }

  async function handleInfoSave() {
    if (!editForm.name.trim() || !editForm.email.trim()) {
      setEditError('Name and email are required.'); return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await api.patch(`/admin/sysadmin/users/${user.id}`, {
        name:     editForm.name.trim(),
        email:    editForm.email.trim().toLowerCase(),
        phone:    editForm.phone.trim() || null,
        position: editForm.position.trim() || null,
      });
      onUserUpdate(user.id, {
        name:     editForm.name.trim(),
        email:    editForm.email.trim().toLowerCase(),
        phone:    editForm.phone.trim() || null,
        position: editForm.position.trim() || null,
      });
      setEditMode(false);
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
  }

  function cancelEdit() {
    setEditMode(false);
    setEditError('');
    setEditForm({ name: user.name, email: user.email, phone: user.phone ?? '', position: user.position ?? '' });
  }

  async function handleLockToggle() {
    setLockSaving(true);
    try {
      const next = !user.isLocked;
      await api.patch(`/admin/employees/${user.id}/lock`, { locked: next });
      onLockUpdate(user.id, next);
    } catch (err) {
      console.error(err);
    } finally {
      setLockSaving(false);
    }
  }

  async function handleReceptionToggle() {
    setReceptionSaving(true);
    try {
      const next = !user.hasReceptionAccess;
      await api.patch(`/reception/access/${user.id}`, { access: next });
      onReceptionUpdate(user.id, next);
    } catch (err) {
      console.error(err);
    } finally {
      setReceptionSaving(false);
    }
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeToBase64(file);
      await api.patch(`/admin/sysadmin/users/${user.id}/photo`, { photoUrl: dataUrl });
      onUserUpdate(user.id, { photoUrl: dataUrl });
    } catch (err) {
      console.error('Photo upload failed:', err);
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="relative bg-shell/60 border-b border-rim/40 px-7 py-5">
          <div className="flex items-center gap-4">

            {/* Clickable avatar / photo */}
            <div
              className="relative shrink-0 group/photo cursor-pointer"
              onClick={() => photoInputRef.current?.click()}
              title="Change photo"
            >
              <div className="w-14 h-14 rounded-full bg-deep border-2 border-rim flex items-center justify-center font-heading font-black text-lg text-fog-hi overflow-hidden">
                {user.photoUrl
                  ? <img src={user.photoUrl} className="w-full h-full object-cover" alt={user.name} />
                  : user.avatar
                }
              </div>
              <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/photo:opacity-100 transition-opacity">
                {photoUploading
                  ? <span className="text-white text-10 font-bold">…</span>
                  : <CameraIcon />
                }
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="font-heading font-black text-ink text-xl leading-none">{user.name}</h2>
                {isSelf && <span className="text-10 text-fog font-bold tracking-widest uppercase">(you)</span>}
                <span className={`text-10 font-bold tracking-widest uppercase px-2.5 py-1 rounded-full border ${role.style}`}>
                  {role.label}
                </span>
              </div>
              <p className="text-sm text-fog mt-1">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-ink transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="p-7 space-y-6 max-h-[70vh] overflow-y-auto">

          {/* Info section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label-xs">Account Information</p>
              {!editMode && (
                <button
                  onClick={() => { setEditMode(true); setEditError(''); }}
                  className="flex items-center gap-1.5 text-10 font-bold tracking-widests uppercase text-fog hover:text-cyan transition-colors"
                >
                  <PencilIcon /> Edit
                </button>
              )}
            </div>

            {editMode ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label-xs block mb-1.5">Full Name</label>
                    <input
                      className="field text-sm"
                      value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Email</label>
                    <input
                      className="field text-sm"
                      type="email"
                      value={editForm.email}
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Phone</label>
                    <input
                      className="field text-sm"
                      placeholder="(225) 555-0100"
                      value={editForm.phone}
                      onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Position</label>
                    <input
                      className="field text-sm"
                      placeholder="e.g. Shift Manager"
                      value={editForm.position}
                      onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))}
                    />
                  </div>
                </div>
                {editError && <p className="text-10 text-red-400 font-semibold">{editError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleInfoSave} disabled={editSaving}
                    className="btn-primary flex-1 text-xs py-2">
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={cancelEdit}
                    className="btn-ghost border border-rim/60 rounded-md flex-1 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <Field label="Full Name"  value={user.name} />
                <Field label="Email"      value={user.email} />
                <Field label="Phone"      value={user.phone ?? '—'} />
                <Field label="Position"   value={user.position ?? '—'} />
                <Field label="Department" value={user.department} />
              </div>
            )}
          </div>

          {/* Role assignment */}
          <div>
            <p className="label-xs mb-3">
              Role Assignment
              {isSelf && <span className="normal-case font-normal tracking-normal text-fog ml-1">— cannot edit your own role</span>}
            </p>
            <div className="flex gap-2 flex-wrap">
              {ROLES.map(r => (
                <button
                  key={r.value}
                  disabled={isSelf || saving}
                  onClick={() => handleRoleChange(r.value)}
                  className={`flex-1 py-2.5 px-3 rounded-lg border text-xs font-bold tracking-wide transition-all
                    ${user.role === r.value
                      ? r.active + ' ring-1 ring-inset ring-current/30'
                      : 'bg-shell/40 border-rim/50 text-fog hover:border-rim hover:text-fog-hi'
                    }
                    ${(isSelf || saving) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Permissions — managers only */}
          {user.role === 'manager' && (
            <PermissionsPanel
              user={user}
              activeDepts={activeDepts}
              deptSaving={deptSaving}
              onToggle={handleDeptToggle}
            />
          )}

          {/* Permissions — sysadmin full access indicator */}
          {user.role === 'sysadmin' && (
            <div>
              <p className="label-xs mb-3">Department Permissions</p>
              <div className="bg-gold/5 border border-gold/20 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-gold">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs font-semibold text-gold">Full Access — All Departments</p>
                  <p className="text-10 text-fog mt-0.5">System Administrators have unrestricted access to view and edit all departments.</p>
                </div>
              </div>
            </div>
          )}

          {/* Department Access — crew members only */}
          {user.role === 'crew_member' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="label-xs">Department Access</p>
                <div className="flex items-center gap-1.5">
                  {deptSaving && <span className="text-10 text-fog animate-pulse">Saving…</span>}
                  <span className="text-10 text-fog">Primary: <span className="text-fog-hi font-semibold">{user.department}</span></span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ALL_DEPARTMENTS.map(dept => {
                  const isActive  = activeDepts.includes(dept);
                  const isPrimary = dept === user.department;
                  const ds = DEPT_STYLE[dept];
                  return (
                    <button
                      key={dept}
                      onClick={() => handleDeptToggle(dept)}
                      disabled={deptSaving || isPrimary}
                      title={isPrimary ? 'Primary department — cannot remove' : undefined}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all
                        ${isActive ? ds.active : 'bg-shell/20 ' + ds.inactive}
                        ${isPrimary ? 'cursor-default opacity-80' : deptSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
                      `}
                    >
                      <span>{dept}</span>
                      <span className="flex items-center gap-1.5 shrink-0 ml-2">
                        {isPrimary && <span className="text-10 tracking-widest uppercase opacity-60">primary</span>}
                        <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                          ${isActive ? 'border-current bg-current/20' : 'border-current/30'}`}>
                          {isActive && (
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5">
                              <polyline points="2 6 5 9 10 3" />
                            </svg>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-10 text-fog mt-2">
                Cross-trained departments give access to restricted content for those areas.
              </p>
            </div>
          )}

          {/* Actions */}
          <div>
            <p className="label-xs mb-3">Account Actions</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-shell/40 border border-rim/40 rounded-xl p-4">
                <p className="text-xs font-semibold text-ink mb-1">Reset Password</p>
                <p className="text-10 text-fog mb-3">Set a new temporary password for this account.</p>
                {!pwMode ? (
                  <button onClick={() => { setPwMode(true); setPwSuccess(false); setPwError(''); }}
                    className="btn-ghost border border-rim/60 rounded-md w-full text-xs">
                    Reset Password
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input type="password" className="field text-xs" placeholder="New password (min 6 chars)"
                      value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus />
                    {pwError   && <p className="text-10 text-red-400 font-semibold">{pwError}</p>}
                    {pwSuccess && <p className="text-10 text-green-400 font-semibold">Password updated.</p>}
                    <div className="flex gap-2">
                      <button onClick={handlePasswordReset} disabled={saving}
                        className="btn-primary flex-1 text-xs py-2">
                        {saving ? 'Saving…' : 'Confirm'}
                      </button>
                      <button onClick={() => { setPwMode(false); setNewPassword(''); setPwError(''); }}
                        className="btn-ghost border border-rim/60 rounded-md flex-1 text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-shell/40 border border-rim/40 rounded-xl p-4 flex flex-col gap-2">
                <p className="text-xs font-semibold text-ink mb-1">Quick Actions</p>
                <button onClick={() => navigate('/messages')}
                  className="btn-ghost border border-rim/60 rounded-md w-full text-xs text-left px-3">
                  Send Message
                </button>
                {user.role === 'crew_member' && (
                  <button onClick={() => navigate('/schedule')}
                    className="btn-ghost border border-rim/60 rounded-md w-full text-xs text-left px-3">
                    View Schedule
                  </button>
                )}
              </div>
            </div>

            {/* Lock account */}
            {!isSelf && (
              <div className={`mt-3 rounded-xl p-4 border ${user.isLocked ? 'bg-amber-950/30 border-amber-500/30' : 'bg-shell/40 border-rim/40'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs font-semibold ${user.isLocked ? 'text-amber-300' : 'text-ink'}`}>
                      {user.isLocked ? 'Account Locked' : 'Lock Account'}
                    </p>
                    <p className="text-10 text-fog mt-0.5">
                      {user.isLocked
                        ? 'This account is locked. The user cannot sign in.'
                        : 'Prevents sign-in without removing the account.'}
                    </p>
                  </div>
                  <button
                    onClick={handleLockToggle}
                    disabled={lockSaving}
                    className={`shrink-0 ml-4 px-4 py-2 rounded-md text-xs font-bold border transition-colors
                      ${user.isLocked
                        ? 'text-green-400 border-green-500/30 hover:bg-green-500/10'
                        : 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10'
                      }
                      ${lockSaving ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {lockSaving ? '…' : user.isLocked ? 'Unlock' : 'Lock'}
                  </button>
                </div>
              </div>
            )}

            {/* Reception portal access */}
            <div className={`mt-3 rounded-xl p-4 border transition-colors ${user.hasReceptionAccess ? 'bg-cyan/5 border-cyan/25' : 'bg-shell/40 border-rim/40'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs font-semibold ${user.hasReceptionAccess ? 'text-cyan' : 'text-ink'}`}>
                    Reception Portal Access
                  </p>
                  <p className="text-10 text-fog mt-0.5">
                    {user.hasReceptionAccess
                      ? 'Can sign in at reception.bluebayoustaff.com'
                      : 'Cannot access the reception portal.'}
                  </p>
                </div>
                <button
                  onClick={handleReceptionToggle}
                  disabled={receptionSaving}
                  className={`shrink-0 ml-4 px-4 py-2 rounded-md text-xs font-bold border transition-colors
                    ${user.hasReceptionAccess
                      ? 'text-red-400 border-red-500/30 hover:bg-red-500/10'
                      : 'text-cyan border-cyan/30 hover:bg-cyan/10'
                    }
                    ${receptionSaving ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {receptionSaving ? '…' : user.hasReceptionAccess ? 'Revoke' : 'Grant Access'}
                </button>
              </div>
            </div>

            {!isSelf && (
              <div className="mt-3 bg-red-950/20 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-red-300">Deactivate Account</p>
                    <p className="text-10 text-fog mt-0.5">Revokes access immediately. This can be reversed.</p>
                  </div>
                  {!deactivateStep ? (
                    <button onClick={() => setDeactivateStep(true)}
                      className="shrink-0 ml-4 px-4 py-2 rounded-md text-xs font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors">
                      Deactivate
                    </button>
                  ) : (
                    <div className="flex gap-2 ml-4 shrink-0">
                      <button onClick={() => setDeactivateStep(false)}
                        className="px-3 py-2 rounded-md text-xs font-bold text-fog border border-rim/60 hover:text-ink transition-colors">
                        Cancel
                      </button>
                      <button className="px-3 py-2 rounded-md text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-colors">
                        Confirm
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="label-xs mb-1">{label}</p>
      <p className="text-sm text-ink font-semibold">{value}</p>
    </div>
  );
}

function resizeToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const size = 200;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
    img.src = objectUrl;
  });
}

// ── Permissions Panel ─────────────────────────────────────────────────────────
const ALL_PERMISSION_DEPTS = [
  { name: 'Aquatics',        color: 'aq',   desc: 'Lifeguards, wave pool, slides, lazy river' },
  { name: 'Food & Beverage', color: 'fb',   desc: 'Concessions, snack shacks, catering' },
  { name: 'Guest Services',  color: 'gs',   desc: 'Main entrance, cabana rentals, info desk' },
  { name: 'Cleaning Crew',   color: 'cc',   desc: 'Park maintenance and sanitation' },
  { name: 'Management',      color: 'mgmt', desc: 'Managerial staff and park-wide operations' },
];

function PermissionsPanel({ user, activeDepts, deptSaving, onToggle }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="label-xs">Department Permissions</p>
          <p className="text-10 text-fog mt-0.5">Controls which departments this manager can view and edit.</p>
        </div>
        {deptSaving && <span className="text-10 text-fog animate-pulse shrink-0">Saving…</span>}
      </div>
      <div className="space-y-2">
        {ALL_PERMISSION_DEPTS.map(dept => {
          const isActive = activeDepts.includes(dept.name);
          return (
            <button
              key={dept.name}
              onClick={() => onToggle(dept.name)}
              disabled={deptSaving}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl border text-left transition-all
                ${isActive
                  ? `bg-${dept.color}/10 border-${dept.color}/30`
                  : 'bg-shell/20 border-rim/40 hover:border-rim/80'
                }
                ${deptSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            >
              {/* Toggle */}
              <div className={`w-8 h-5 rounded-full transition-all shrink-0 relative ${isActive ? `bg-${dept.color}/70` : 'bg-rim/60'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
                  ${isActive ? 'left-3.5' : 'left-0.5'}`}
                />
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${isActive ? `text-${dept.color}` : 'text-fog-hi'}`}>
                  {dept.name}
                </p>
                <p className="text-10 text-fog mt-0.5">{dept.desc}</p>
              </div>
              {/* Badge */}
              <span className={`shrink-0 text-10 font-bold tracking-widests uppercase px-2.5 py-1 rounded-full border transition-all
                ${isActive
                  ? `bg-${dept.color}/10 border-${dept.color}/30 text-${dept.color}`
                  : 'bg-transparent border-rim/40 text-fog'}`}>
                {isActive ? 'Enabled' : 'No Access'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Create User Modal ─────────────────────────────────────────────────────────
const MGMT_ROLES = ROLES.filter(r => r.value === 'manager' || r.value === 'sysadmin');

function CreateUserModal({ onClose, onCreated }) {
  const backdropRef = useRef(null);
  const [form, setForm]     = useState({ name: '', email: '', password: '', role: 'manager', phone: '', position: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function handleBackdrop(e) { if (e.target === backdropRef.current) onClose(); }
  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function autoAvatar(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError('Name, email, and password are required.'); return;
    }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/admin/sysadmin/users', {
        name:        form.name.trim(),
        email:       form.email.trim().toLowerCase(),
        password:    form.password,
        role:        form.role,
        department:  'Management',
        departments: ['Management'],
        position:    form.position.trim() || null,
        phone:       form.phone.trim() || null,
        avatar:      autoAvatar(form.name),
      });
      onCreated(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  const selectedRole = MGMT_ROLES.find(r => r.value === form.role);

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-3xl mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-shell/60 border-b border-rim/40 px-7 py-5 flex items-center justify-between">
          <div>
            <p className="label-xs mb-1">System Admin / Users</p>
            <h2 className="font-heading font-black text-ink text-xl leading-none">New Management Account</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-ink transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Form — two column layout */}
        <form onSubmit={handleSubmit} className="p-7">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">

            {/* Left column */}
            <div className="space-y-5">

              {/* Role selector */}
              <div>
                <p className="label-xs mb-3">Access Level</p>
                <div className="flex gap-2">
                  {MGMT_ROLES.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, role: r.value }))}
                      className={`flex-1 py-3 px-4 rounded-xl border text-xs font-bold tracking-wide transition-all
                        ${form.role === r.value
                          ? r.active + ' ring-1 ring-inset ring-current/30'
                          : 'bg-shell/40 border-rim/50 text-fog hover:border-rim hover:text-fog-hi'
                        }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="text-10 text-fog mt-2">
                  {form.role === 'sysadmin'
                    ? 'Full access to all system settings, user management, and all departments.'
                    : 'Access to scheduling, staff management, and assigned departments.'}
                </p>
              </div>

              {/* Name */}
              <div>
                <label className="label-xs block mb-2">Full Name *</label>
                <input className="field text-sm" placeholder="Jane Smith" value={form.name} onChange={set('name')} required />
              </div>

              {/* Email */}
              <div>
                <label className="label-xs block mb-2">Email *</label>
                <input className="field text-sm" type="email" placeholder="jane@bluebayou.com" value={form.email} onChange={set('email')} required />
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-5">

              {/* Position */}
              <div>
                <label className="label-xs block mb-2">Position</label>
                <input className="field text-sm" placeholder="e.g. Shift Manager" value={form.position} onChange={set('position')} />
              </div>

              {/* Phone */}
              <div>
                <label className="label-xs block mb-2">Phone</label>
                <input className="field text-sm" placeholder="(225) 555-0100" value={form.phone} onChange={set('phone')} />
              </div>

              {/* Password */}
              <div>
                <label className="label-xs block mb-2">Temporary Password *</label>
                <input className="field text-sm" type="password" placeholder="Min. 6 characters" value={form.password} onChange={set('password')} required />
                <p className="text-10 text-fog mt-1.5">User should change this after first login.</p>
              </div>

            </div>
          </div>

          {error && <p className="text-xs text-red-400 font-semibold mt-4">{error}</p>}

          <div className="flex gap-3 mt-6">
            <button type="button" onClick={onClose}
              className="flex-1 btn-ghost border border-rim/60 rounded-md text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className={`flex-1 btn-primary text-sm ${selectedRole?.value === 'sysadmin' ? 'bg-gold hover:bg-gold-dark text-void' : ''}`}>
              {saving ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function RowLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} className="w-5 h-5">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
