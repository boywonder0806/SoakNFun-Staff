import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api.js';
import { DEPT_COLOR } from './Layout/Sidebar.jsx';

const DEPARTMENTS = ['Aquatics', 'Guest Services', 'Food & Beverage', 'Cleaning Crew'];

const DEPT_PILL = {
  'Aquatics':        'bg-aq/10 border-aq/30 text-aq',
  'Guest Services':  'bg-gs/10 border-gs/30 text-gs',
  'Food & Beverage': 'bg-fb/10 border-fb/30 text-fb',
  'Cleaning Crew':   'bg-cc/10 border-cc/30 text-cc',
  'Management':      'bg-mgmt/10 border-mgmt/30 text-mgmt',
};

const DEPT_AVATAR = {
  'Aquatics':        'border-aq/50 text-aq',
  'Guest Services':  'border-gs/50 text-gs',
  'Food & Beverage': 'border-fb/50 text-fb',
  'Cleaning Crew':   'border-cc/50 text-cc',
  'Management':      'border-mgmt/50 text-mgmt',
};

const TABS = [
  { id: 'info',     label: 'Info' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'timeoff',  label: 'Time Off' },
  { id: 'notes',    label: 'Notes' },
  { id: 'account',  label: 'Account' },
];

// ── Main shared component ─────────────────────────────────────────────────────
// onClose: null = no close button | fn = show close button
// popoutHref: null = already in popup (hide button) | string = show popout link
export default function StaffProfileContent({ emp, onUpdated, onDeleted, currentUser, onClose, popoutHref }) {
  const [tab, setTab] = useState('info');

  // Info tab
  const [editMode, setEditMode]     = useState(false);
  const [editForm, setEditForm]     = useState({
    name:       emp.name,
    email:      emp.email,
    phone:      emp.phone ?? '',
    position:   emp.position ?? '',
    department: emp.department ?? '',
    hireDate:   emp.hireDate ? emp.hireDate.slice(0, 10) : '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError]   = useState('');

  // Schedule tab
  const [shifts, setShifts]               = useState([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsLoaded, setShiftsLoaded]   = useState(false);

  // Time Off tab
  const [timeoff, setTimeoff]               = useState([]);
  const [timeoffLoading, setTimeoffLoading] = useState(false);
  const [timeoffLoaded, setTimeoffLoaded]   = useState(false);

  // Notes tab
  const [notes, setNotes]               = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesLoaded, setNotesLoaded]   = useState(false);
  const [noteText, setNoteText]         = useState('');
  const [notesSaving, setNotesSaving]   = useState(false);

  // Account tab
  const [logs, setLogs]               = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded]   = useState(false);
  const [resetEmailSending, setResetEmailSending] = useState(false);
  const [resetEmailSent, setResetEmailSent]       = useState(false);
  const [welcomeSending, setWelcomeSending] = useState(false);
  const [welcomeSent, setWelcomeSent]       = useState(false);
  const [lockSaving, setLockSaving]       = useState(false);
  const [statusSaving, setStatusSaving]   = useState(false);
  const [deactivateConfirm, setDeactivateConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm]         = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleting, setDeleting]                   = useState(false);
  const [deleteError, setDeleteError]             = useState('');
  const [receptionSaving, setReceptionSaving] = useState(false);
  const [receptionManagerSaving, setReceptionManagerSaving] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const color     = DEPT_COLOR[emp.department];
  const pillStyle = DEPT_PILL[emp.department] ?? 'bg-rim/20 border-rim/40 text-fog';

  useEffect(() => {
    if (tab === 'schedule' && !shiftsLoaded) {
      setShiftsLoading(true);
      api.get(`/admin/staff/${emp.id}/schedule`)
        .then(r => { setShifts(r.data.shifts); setShiftsLoaded(true); })
        .catch(() => setShiftsLoaded(true))
        .finally(() => setShiftsLoading(false));
    }
    if (tab === 'timeoff' && !timeoffLoaded) {
      setTimeoffLoading(true);
      api.get(`/admin/staff/${emp.id}/timeoff`)
        .then(r => { setTimeoff(r.data.requests); setTimeoffLoaded(true); })
        .catch(() => setTimeoffLoaded(true))
        .finally(() => setTimeoffLoading(false));
    }
    if (tab === 'notes' && !notesLoaded) {
      setNotesLoading(true);
      api.get(`/admin/staff/${emp.id}/notes`)
        .then(r => { setNotes(r.data.notes); setNotesLoaded(true); })
        .catch(() => setNotesLoaded(true))
        .finally(() => setNotesLoading(false));
    }
    if (tab === 'account' && !logsLoaded) {
      setLogsLoading(true);
      api.get(`/admin/staff/${emp.id}/logs`)
        .then(r => { setLogs(r.data.logs); setLogsLoaded(true); })
        .catch(() => setLogsLoaded(true))
        .finally(() => setLogsLoading(false));
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!editForm.name.trim()) { setEditError('Name is required.'); return; }
    setEditSaving(true); setEditError('');
    try {
      const { data } = await api.patch(`/admin/staff/${emp.id}`, {
        name:       editForm.name.trim() || null,
        email:      editForm.email.trim().toLowerCase() || null,
        phone:      editForm.phone.trim() || null,
        position:   editForm.position.trim() || null,
        department: editForm.department || null,
        hireDate:   editForm.hireDate || null,
      });
      onUpdated(data.employee);
      setEditMode(false);
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
  }

  function cancelEdit() {
    setEditMode(false); setEditError('');
    setEditForm({
      name:       emp.name,
      email:      emp.email,
      phone:      emp.phone ?? '',
      position:   emp.position ?? '',
      department: emp.department ?? '',
      hireDate:   emp.hireDate ? emp.hireDate.slice(0, 10) : '',
    });
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setNotesSaving(true);
    try {
      const { data } = await api.post(`/admin/staff/${emp.id}/notes`, { body: noteText.trim() });
      setNotes(prev => [data.note, ...prev]);
      setNoteText('');
    } catch {}
    finally { setNotesSaving(false); }
  }

  async function handleSendPasswordReset() {
    setResetEmailSending(true);
    try {
      await api.post(`/admin/employees/${emp.id}/send-password-reset`);
      setLogs(prev => [{ id: Date.now(), event: 'Password reset email sent', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 4000);
    } catch {}
    finally { setResetEmailSending(false); }
  }

  async function handleResendWelcome() {
    setWelcomeSending(true);
    try {
      await api.post(`/admin/staff/${emp.id}/resend-welcome`);
      setLogs(prev => [{ id: Date.now(), event: 'Welcome email resent', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      setWelcomeSent(true);
      setTimeout(() => setWelcomeSent(false), 4000);
    } catch {}
    finally { setWelcomeSending(false); }
  }

  async function handleLockToggle() {
    setLockSaving(true);
    try {
      await api.patch(`/admin/employees/${emp.id}/lock`, { locked: !emp.isLocked });
      setLogs(prev => [{ id: Date.now(), event: emp.isLocked ? 'Account unlocked' : 'Account locked', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      onUpdated({ ...emp, isLocked: !emp.isLocked });
    } catch {}
    finally { setLockSaving(false); }
  }

  async function handleStatusToggle() {
    setStatusSaving(true);
    try {
      await api.patch(`/admin/staff/${emp.id}/status`, { isActive: !emp.isActive });
      setLogs(prev => [{ id: Date.now(), event: emp.isActive ? 'Account deactivated' : 'Account reactivated', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      onUpdated({ ...emp, isActive: !emp.isActive });
    } catch {}
    finally { setStatusSaving(false); setDeactivateConfirm(false); }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/admin/employees/${emp.id}`, { data: { confirmEmail: deleteConfirmEmail } });
      if (onDeleted) onDeleted(emp.id); else onClose();
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete account.');
      setDeleting(false);
    }
  }

  async function handleDeleteNote(noteId) {
    try {
      await api.delete(`/admin/staff/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch {}
  }

  async function handleReceptionToggle() {
    setReceptionSaving(true);
    const newAccess = !emp.hasReceptionAccess;
    try {
      await api.patch(`/admin/staff/${emp.id}/reception-access`, { hasAccess: newAccess });
      setLogs(prev => [{ id: Date.now(), event: newAccess ? 'Reception access granted' : 'Reception access revoked', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      onUpdated({ ...emp, hasReceptionAccess: newAccess, isReceptionManager: newAccess ? emp.isReceptionManager : false });
    } catch {}
    finally { setReceptionSaving(false); }
  }

  async function handleResendInvite() {
    setInviteSending(true);
    setInviteSent(false);
    try {
      await api.post(`/admin/staff/${emp.id}/resend-reception-invite`);
      setInviteSent(true);
      setTimeout(() => setInviteSent(false), 4000);
    } catch {}
    finally { setInviteSending(false); }
  }

  async function handleReceptionManagerToggle() {
    setReceptionManagerSaving(true);
    const newVal = !emp.isReceptionManager;
    try {
      await api.patch(`/admin/staff/${emp.id}/reception-manager`, { isManager: newVal });
      setLogs(prev => [{ id: Date.now(), event: newVal ? 'Reception manager role granted' : 'Reception manager role removed', createdAt: new Date().toISOString(), actorName: currentUser?.name }, ...prev]);
      onUpdated({ ...emp, isReceptionManager: newVal });
    } catch {}
    finally { setReceptionManagerSaving(false); }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Dept accent bar */}
      <div className={`h-1.5 w-full shrink-0 ${color?.bar ?? 'bg-rim/40'}`} />

      {/* Header */}
      <div className="relative bg-shell/50 border-b border-rim/40 px-8 py-6 shrink-0">
        <div className="flex items-center gap-5 pr-20">
          <div className={`w-20 h-20 rounded-full border-2 ${DEPT_AVATAR[emp.department] ?? 'border-rim/50 text-fog-hi'} flex items-center justify-center overflow-hidden font-heading font-black text-2xl bg-deep shrink-0`}>
            {emp.photoUrl
              ? <img src={emp.photoUrl} className="w-full h-full object-cover" alt={emp.name} />
              : <span>{emp.avatar}</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-heading font-black text-ink text-2xl leading-none">{emp.name}</h2>
              {emp.department && (
                <span className={`text-10 font-bold tracking-widests uppercase px-2.5 py-1 rounded-full border ${pillStyle}`}>
                  {emp.department}
                </span>
              )}
            </div>
            <p className="text-sm text-fog mt-1.5">{emp.position ?? 'No position set'}</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-10 font-semibold
                ${emp.isLocked ? 'text-amber-400' : emp.isActive ? 'text-green-400' : 'text-red-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${emp.isLocked ? 'bg-amber-400' : emp.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                {emp.isLocked ? 'Account Locked' : emp.isActive ? 'Active' : 'Inactive'}
              </span>
              {emp.hasReceptionAccess && (
                <span className={`inline-flex items-center gap-1.5 text-10 font-semibold
                  ${emp.isActive && !emp.isLocked ? 'text-cyan' : 'text-fog'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive && !emp.isLocked ? 'bg-cyan' : 'bg-fog/50'}`} />
                  Reception Portal {emp.isActive && !emp.isLocked ? '' : '(blocked)'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="absolute top-5 right-6 flex items-center gap-2">
          {popoutHref && (
            <a
              href={popoutHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              className="w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-cyan transition-colors"
            >
              <PopoutIcon />
            </a>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-ink transition-colors"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-rim/40 bg-shell/30 px-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-6 py-3.5 text-xs font-bold tracking-widest uppercase transition-all border-b-2 -mb-px
              ${tab === t.id
                ? 'text-cyan border-cyan'
                : 'text-fog hover:text-fog-hi border-transparent'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">

        {/* ── INFO ── */}
        {tab === 'info' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <p className="label-xs">Staff Information</p>
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
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label-xs block mb-1.5">Full Name</label>
                    <input className="field text-sm" value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Email</label>
                    <input className="field text-sm" type="email" value={editForm.email}
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Phone</label>
                    <input className="field text-sm" placeholder="(225) 555-0100" value={editForm.phone}
                      onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Position</label>
                    <input className="field text-sm" placeholder="e.g. Lifeguard II" value={editForm.position}
                      onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Department</label>
                    <select className="field text-sm" value={editForm.department}
                      onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))}>
                      <option value="">— Select —</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label-xs block mb-1.5">Hire Date</label>
                    <input className="field text-sm" type="date" value={editForm.hireDate}
                      onChange={e => setEditForm(f => ({ ...f, hireDate: e.target.value }))} />
                  </div>
                </div>
                {editError && <p className="text-10 text-red-400 font-semibold">{editError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={editSaving} className="btn-primary flex-1 text-xs py-2">
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={cancelEdit} className="btn-ghost border border-rim/60 rounded-md flex-1 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-8 gap-y-6">
                <InfoField label="Full Name"  value={emp.name} />
                <InfoField label="Email"      value={emp.email} />
                <InfoField label="Phone"      value={emp.phone ?? '—'} />
                <InfoField label="Position"   value={emp.position ?? '—'} />
                <InfoField label="Department" value={emp.department ?? '—'} />
                <InfoField label="Hire Date"  value={emp.hireDate ? format(parseISO(emp.hireDate), 'MMMM d, yyyy') : '—'} />
                {emp.departments?.length > 1 && (
                  <div className="col-span-3">
                    <InfoField label="Cross-trained"
                      value={emp.departments.filter(d => d !== emp.department).join(', ')} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {tab === 'schedule' && (
          <div>
            <p className="label-xs mb-5">Shifts — Recent &amp; Upcoming</p>
            {shiftsLoading ? (
              <p className="text-fog text-sm text-center py-16">Loading…</p>
            ) : shifts.length === 0 ? (
              <p className="text-fog text-sm text-center py-16">No shifts on record for this staff member.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {shifts.map(s => <ShiftRow key={s.id} shift={s} />)}
              </div>
            )}
          </div>
        )}

        {/* ── TIME OFF ── */}
        {tab === 'timeoff' && (
          <div>
            <p className="label-xs mb-5">Time Off Requests</p>
            {timeoffLoading ? (
              <p className="text-fog text-sm text-center py-16">Loading…</p>
            ) : timeoff.length === 0 ? (
              <p className="text-fog text-sm text-center py-16">No time off requests on record.</p>
            ) : (
              <div className="space-y-2">
                {timeoff.map(r => <TimeOffRow key={r.id} request={r} />)}
              </div>
            )}
          </div>
        )}

        {/* ── NOTES ── */}
        {tab === 'notes' && (
          <div className="space-y-5">
            <div>
              <p className="label-xs mb-3">Add Note</p>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Write a note about this staff member…"
                rows={4}
                className="field text-sm w-full resize-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote();
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-10 text-fog">Cmd/Ctrl+Enter to submit</p>
                <button
                  onClick={handleAddNote}
                  disabled={notesSaving || !noteText.trim()}
                  className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
                >
                  {notesSaving ? 'Saving…' : 'Add Note'}
                </button>
              </div>
            </div>
            <div className="border-t border-rim/30 pt-5">
              <p className="label-xs mb-4">Notes History</p>
              {notesLoading ? (
                <p className="text-fog text-sm text-center py-8">Loading…</p>
              ) : notes.length === 0 ? (
                <p className="text-fog text-sm text-center py-8">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map(n => (
                    <NoteItem
                      key={n.id}
                      note={n}
                      canDelete={n.authorId === currentUser?.id || currentUser?.role === 'sysadmin'}
                      onDelete={() => handleDeleteNote(n.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ACCOUNT ── */}
        {tab === 'account' && (
          <div className="space-y-7">

            {/* Overview */}
            <div>
              <p className="label-xs mb-4">Account Overview</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="panel p-4">
                  <p className="label-xs mb-1">Role</p>
                  <p className="text-sm font-semibold text-ink capitalize">{emp.role?.replace('_', ' ') ?? '—'}</p>
                </div>
                <div className="panel p-4">
                  <p className="label-xs mb-1">Member Since</p>
                  <p className="text-sm font-semibold text-ink">
                    {emp.createdAt ? format(parseISO(emp.createdAt), 'MMM d, yyyy') : '—'}
                  </p>
                </div>
                <div className="panel p-4">
                  <p className="label-xs mb-1">Status</p>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold
                    ${emp.isLocked ? 'text-amber-400' : emp.isActive ? 'text-green-400' : 'text-red-400'}`}>
                    <span className={`w-2 h-2 rounded-full ${emp.isLocked ? 'bg-amber-400' : emp.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                    {emp.isLocked ? 'Locked' : emp.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            {/* Reception access — shown for all roles except sysadmin */}
            {emp.role !== 'sysadmin' && (() => {
              const blocked  = !emp.isActive || emp.isLocked;
              const effectiveAccess = emp.hasReceptionAccess && !blocked;
              const blockReason = !emp.isActive ? 'Account is deactivated'
                                : emp.isLocked  ? 'Account is locked'
                                : null;
              return (
                <div>
                  <p className="label-xs mb-4">Portal Access</p>
                  <div className={`panel p-4 ${
                    effectiveAccess          ? 'border-cyan/30 bg-cyan/5'
                    : blocked && emp.hasReceptionAccess ? 'border-amber-500/20 bg-amber-950/10'
                    : ''
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">Reception Portal</p>
                        <p className="text-10 text-fog mt-0.5">
                          {emp.hasReceptionAccess
                            ? 'This staff member is granted reception portal access'
                            : 'Grant access to the reception portal (call log, lost & found)'}
                        </p>

                        {/* Effective access indicator */}
                        {effectiveAccess && (
                          <span className="inline-flex items-center gap-1.5 text-10 font-semibold text-cyan mt-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan" /> Access active
                          </span>
                        )}
                        {emp.hasReceptionAccess && blocked && (
                          <span className="inline-flex items-center gap-1.5 text-10 font-semibold text-amber-400 mt-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Access granted but blocked
                          </span>
                        )}
                      </div>

                      <button
                        onClick={handleReceptionToggle}
                        disabled={receptionSaving || blocked}
                        title={blocked ? `${blockReason} — reactivate account first` : undefined}
                        className={`rounded-md px-3 py-1.5 text-xs shrink-0 border font-semibold transition-colors
                          ${blocked
                            ? 'opacity-40 cursor-not-allowed border-rim/40 text-fog bg-shell/30'
                            : emp.hasReceptionAccess
                              ? 'bg-red-950/20 border-red-500/30 text-red-400 hover:bg-red-950/40'
                              : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'
                          }`}
                      >
                        {receptionSaving ? 'Saving…' : emp.hasReceptionAccess ? 'Revoke' : 'Grant Access'}
                      </button>
                    </div>

                    {/* Resend invite */}
                    {emp.hasReceptionAccess && !blocked && (
                      <div className="mt-3 pt-3 border-t border-rim/20 flex items-center justify-between gap-3">
                        <p className="text-10 text-fog">
                          {inviteSent ? 'Invite sent to their email.' : 'Send portal login instructions to their email.'}
                        </p>
                        <button
                          onClick={handleResendInvite}
                          disabled={inviteSending}
                          className="text-10 font-semibold text-cyan hover:text-cyan/70 transition-colors shrink-0 disabled:opacity-50"
                        >
                          {inviteSending ? 'Sending…' : inviteSent ? 'Sent ✓' : 'Resend Invite'}
                        </button>
                      </div>
                    )}

                    {/* Blocked account warning */}
                    {blocked && emp.hasReceptionAccess && (
                      <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-start gap-2">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <p className="text-10 text-amber-400 leading-relaxed">
                          <span className="font-semibold">{blockReason}.</span> Portal login is blocked regardless of this setting. {!emp.isActive ? 'Reactivate' : 'Unlock'} the account to restore access.
                        </p>
                      </div>
                    )}
                    {blocked && !emp.hasReceptionAccess && (
                      <div className="mt-3 pt-3 border-t border-rim/20 flex items-start gap-2">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-fog shrink-0 mt-0.5">
                          <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                        <p className="text-10 text-fog leading-relaxed">
                          {blockReason}. Grant access will take effect once the account is {!emp.isActive ? 'reactivated' : 'unlocked'}.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Reception Manager sub-toggle — only when access is granted */}
                  {emp.hasReceptionAccess && (
                    <div className={`mt-3 pt-3 border-t border-rim/30 flex items-start justify-between gap-3`}>
                      <div>
                        <p className="text-xs font-semibold text-ink">Reception Manager</p>
                        <p className="text-10 text-fog mt-0.5">
                          {emp.isReceptionManager
                            ? 'Can access the Configurator tab to manage templates, FAQs, and callback handlers'
                            : 'Grant configurator access to manage templates, FAQs, and callback handlers'}
                        </p>
                        {emp.isReceptionManager && (
                          <span className="inline-flex items-center gap-1.5 text-10 font-semibold text-violet-400 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" /> Manager role active
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleReceptionManagerToggle}
                        disabled={receptionManagerSaving || blocked}
                        className={`rounded-md px-3 py-1.5 text-xs shrink-0 border font-semibold transition-colors
                          ${blocked
                            ? 'opacity-40 cursor-not-allowed border-rim/40 text-fog bg-shell/30'
                            : emp.isReceptionManager
                              ? 'bg-red-950/20 border-red-500/30 text-red-400 hover:bg-red-950/40'
                              : 'bg-violet-950/20 border-violet-500/30 text-violet-400 hover:bg-violet-950/40'
                          }`}
                      >
                        {receptionManagerSaving ? 'Saving…' : emp.isReceptionManager ? 'Remove' : 'Make Manager'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Security actions */}
            <div>
              <p className="label-xs mb-4">Security</p>
              <div className="grid grid-cols-2 gap-4">

                {/* Reset password */}
                <div className="panel p-4 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">Reset Password</p>
                    <p className="text-10 text-fog mt-0.5">
                      {resetEmailSent ? 'Reset link sent — check their inbox.' : 'Send them an email with a link to set a new password'}
                    </p>
                  </div>
                  <button
                    onClick={handleSendPasswordReset}
                    disabled={resetEmailSending}
                    className="btn-ghost border border-rim/60 rounded-md px-3 py-1.5 text-xs shrink-0 ml-3 disabled:opacity-50"
                  >
                    {resetEmailSending ? 'Sending…' : resetEmailSent ? 'Sent ✓' : 'Send Email'}
                  </button>
                </div>

                {/* Send welcome email */}
                <div className="panel p-4 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">Send Welcome Email</p>
                    <p className="text-10 text-fog mt-0.5">Email them their login link and account info</p>
                    {welcomeSent && <p className="text-10 text-green-400 font-semibold mt-1.5">Sent — check their inbox</p>}
                  </div>
                  <button onClick={handleResendWelcome} disabled={welcomeSending}
                    className="btn-ghost border border-rim/60 rounded-md px-3 py-1.5 text-xs shrink-0 ml-3">
                    {welcomeSending ? 'Sending…' : 'Send'}
                  </button>
                </div>

                {/* Lock / Unlock */}
                <div className={`panel p-4 flex items-start justify-between ${emp.isLocked ? 'border-amber-500/30 bg-amber-950/10' : ''}`}>
                  <div>
                    <p className="text-sm font-semibold text-ink">{emp.isLocked ? 'Unlock Account' : 'Lock Account'}</p>
                    <p className="text-10 text-fog mt-0.5">
                      {emp.isLocked ? 'Restore login access for this staff member' : 'Immediately prevent this staff member from logging in'}
                    </p>
                  </div>
                  <button onClick={handleLockToggle} disabled={lockSaving}
                    className={`rounded-md px-3 py-1.5 text-xs shrink-0 ml-3 border font-semibold transition-colors
                      ${emp.isLocked
                        ? 'bg-green-950/30 border-green-500/40 text-green-400 hover:bg-green-950/50'
                        : 'bg-amber-950/20 border-amber-500/30 text-amber-400 hover:bg-amber-950/40'}`}>
                    {lockSaving ? 'Saving…' : emp.isLocked ? 'Unlock' : 'Lock'}
                  </button>
                </div>

                {/* Deactivate / Reactivate */}
                <div className={`panel p-4 ${!emp.isActive ? 'border-green-500/20' : 'border-red-500/20'}`}>
                  {deactivateConfirm ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-red-400">Confirm Deactivation</p>
                      <p className="text-10 text-fog">This will remove all login access. You can reactivate the account at any time.</p>
                      <div className="flex gap-2">
                        <button onClick={handleStatusToggle} disabled={statusSaving}
                          className="flex-1 text-xs py-1.5 rounded-md bg-red-950/30 border border-red-500/40 text-red-400 hover:bg-red-950/50 font-semibold transition-colors">
                          {statusSaving ? 'Saving…' : 'Confirm Deactivate'}
                        </button>
                        <button onClick={() => setDeactivateConfirm(false)}
                          className="btn-ghost border border-rim/60 rounded-md flex-1 text-xs py-1.5">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-ink">{emp.isActive ? 'Deactivate Account' : 'Reactivate Account'}</p>
                        <p className="text-10 text-fog mt-0.5">
                          {emp.isActive ? 'Permanently remove login access (reversible)' : 'Restore this staff member\'s access'}
                        </p>
                      </div>
                      <button
                        onClick={() => emp.isActive ? setDeactivateConfirm(true) : handleStatusToggle()}
                        disabled={statusSaving}
                        className={`rounded-md px-3 py-1.5 text-xs shrink-0 ml-3 border font-semibold transition-colors
                          ${emp.isActive
                            ? 'bg-red-950/20 border-red-500/30 text-red-400 hover:bg-red-950/40'
                            : 'bg-green-950/20 border-green-500/30 text-green-400 hover:bg-green-950/40'}`}>
                        {statusSaving ? 'Saving…' : emp.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </div>

              </div>

              {/* Delete account permanently */}
              <div className="panel p-4 border-red-500/30 bg-red-950/10 mt-4">
                {deleteConfirm ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-red-400">Permanently Delete Account</p>
                    <p className="text-10 text-fog">
                      This removes their login and all shifts, timecards, time-off history, and certifications. This cannot be undone.
                    </p>
                    {deleteError && <p className="text-10 text-red-400">{deleteError}</p>}
                    <label className="label-xs block">
                      Type <span className="font-mono text-ink">{emp.email}</span> to confirm
                    </label>
                    <input
                      className="field text-xs"
                      value={deleteConfirmEmail}
                      onChange={e => setDeleteConfirmEmail(e.target.value)}
                      placeholder={emp.email}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleting || deleteConfirmEmail.trim().toLowerCase() !== emp.email.toLowerCase()}
                        className="flex-1 text-xs py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {deleting ? 'Deleting…' : 'Delete Permanently'}
                      </button>
                      <button
                        onClick={() => { setDeleteConfirm(false); setDeleteConfirmEmail(''); setDeleteError(''); }}
                        disabled={deleting}
                        className="btn-ghost border border-rim/60 rounded-md flex-1 text-xs py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">Delete Account</p>
                      <p className="text-10 text-fog mt-0.5">Permanently remove this account and all of their data</p>
                    </div>
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      disabled={currentUser?.role !== 'sysadmin'}
                      title={currentUser?.role !== 'sysadmin' ? 'Only a system administrator can delete accounts' : undefined}
                      className="rounded-md px-3 py-1.5 text-xs shrink-0 ml-3 border font-semibold transition-colors
                        bg-red-950/20 border-red-500/30 text-red-400 hover:bg-red-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Activity log */}
            <div>
              <p className="label-xs mb-4">Activity Log</p>
              {logsLoading ? (
                <p className="text-fog text-sm text-center py-8">Loading…</p>
              ) : logs.length === 0 ? (
                <p className="text-fog text-sm text-center py-8">No activity recorded yet.</p>
              ) : (
                <div className="border border-rim/30 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-rim/30 bg-shell/40">
                        <th className="text-left px-4 py-2.5 label-xs">Event</th>
                        <th className="text-left px-4 py-2.5 label-xs">By</th>
                        <th className="text-left px-4 py-2.5 label-xs">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l, i) => (
                        <tr key={l.id} className={`border-b border-rim/20 last:border-0 ${i % 2 === 0 ? '' : 'bg-shell/20'}`}>
                          <td className="px-4 py-2.5 font-semibold text-ink">{l.event}</td>
                          <td className="px-4 py-2.5 text-fog">{l.actorName ?? '—'}</td>
                          <td className="px-4 py-2.5 text-fog whitespace-nowrap">
                            {format(parseISO(l.createdAt), 'MMM d, yyyy h:mm a')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function ShiftRow({ shift }) {
  const today    = new Date().toISOString().slice(0, 10);
  const isToday  = shift.date === today;
  const isUpcoming = shift.date > today;
  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-lg border transition-colors
      ${isToday || isUpcoming ? 'border-rim/50 bg-shell/40' : 'border-rim/20 bg-shell/10 opacity-55'}`}>
      <div className="shrink-0 text-center w-14">
        <p className="text-10 text-fog leading-none mb-0.5">{format(parseISO(shift.date), 'EEE')}</p>
        <p className="text-sm font-bold text-ink leading-none">{format(parseISO(shift.date), 'MMM d')}</p>
      </div>
      <div className="w-px h-8 bg-rim/40 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink">{fmtTime(shift.start)} – {fmtTime(shift.end)}</p>
        <p className="text-10 text-fog mt-0.5">
          {shift.position || shift.department || '—'}
          {shift.location ? ` · ${shift.location}` : ''}
        </p>
      </div>
      {isToday && (
        <span className="text-10 font-bold text-green-400 px-2 py-0.5 rounded-full bg-green-950/30 border border-green-500/25 shrink-0">
          Today
        </span>
      )}
      {isUpcoming && (
        <span className="text-10 font-bold text-cyan px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/25 shrink-0">
          Upcoming
        </span>
      )}
    </div>
  );
}

function TimeOffRow({ request }) {
  const STATUS = {
    pending:  { style: 'bg-amber-950/30 border-amber-500/25 text-amber-300', label: 'Pending' },
    approved: { style: 'bg-green-950/30 border-green-500/25 text-green-300', label: 'Approved' },
    denied:   { style: 'bg-red-950/30 border-red-500/25 text-red-400',       label: 'Denied' },
  };
  const s = STATUS[request.status] ?? STATUS.pending;
  return (
    <div className="flex items-start gap-4 px-4 py-3 rounded-lg border border-rim/30 bg-shell/20">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink">
          {format(parseISO(request.startDate), 'MMM d, yyyy')}
          {request.endDate !== request.startDate && (
            <> – {format(parseISO(request.endDate), 'MMM d, yyyy')}</>
          )}
        </p>
        {request.reason && <p className="text-10 text-fog mt-0.5 line-clamp-2">{request.reason}</p>}
        {request.reviewNotes && <p className="text-10 text-fog-hi mt-1 italic">"{request.reviewNotes}"</p>}
      </div>
      <span className={`text-10 font-bold px-2.5 py-1 rounded-full border shrink-0 ${s.style}`}>{s.label}</span>
    </div>
  );
}

function NoteItem({ note, canDelete, onDelete }) {
  return (
    <div className="px-4 py-3 rounded-lg border border-rim/30 bg-shell/20 space-y-2">
      <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{note.body}</p>
      <div className="flex items-center justify-between">
        <p className="text-10 text-fog">
          {note.authorName} &middot; {format(parseISO(note.createdAt), 'MMM d, yyyy h:mm a')}
        </p>
        {canDelete && (
          <button
            onClick={onDelete}
            className="text-fog hover:text-red-400 transition-colors p-1 -m-1 rounded hover:bg-red-950/20"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <p className="label-xs mb-1">{label}</p>
      <p className="text-sm text-ink font-semibold">{value}</p>
    </div>
  );
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  );
}
function PopoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
