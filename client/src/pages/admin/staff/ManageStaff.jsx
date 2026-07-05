import { useState, useEffect, useRef } from 'react';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DEPT_COLOR } from '../../../components/Layout/Sidebar.jsx';
import StaffProfileContent from '../../../components/StaffProfileContent.jsx';

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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ManageStaff() {
  const [staff, setStaff]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [selected, setSelected]     = useState(null);
  const [adding, setAdding]         = useState(false);

  useEffect(() => {
    api.get('/admin/employees')
      .then(r => setStaff(r.data.employees.filter(e => e.role === 'crew_member')))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const depts = ['All', ...Array.from(new Set(staff.map(e => e.department).filter(Boolean))).sort()];

  const visible = staff.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      e.name?.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q) ||
      e.position?.toLowerCase().includes(q);
    const matchDept = deptFilter === 'All' || e.department === deptFilter;
    return matchSearch && matchDept;
  });

  function handleAdded(emp) {
    setStaff(prev => [...prev, emp].sort((a, b) => a.name.localeCompare(b.name)));
    setAdding(false);
  }

  function handleUpdated(emp) {
    setStaff(prev => prev.map(s => s.id === emp.id ? emp : s));
    setSelected(emp);
  }

  function handleDeleted(id) {
    setStaff(prev => prev.filter(s => s.id !== id));
    setSelected(null);
  }

  return (
    <div className="flex flex-col gap-5" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Header */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <p className="label-xs mb-1">Staff / Management</p>
          <h1 className="font-heading font-black text-ink text-3xl leading-none uppercase tracking-tight">
            Manage Staff
          </h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <span className="text-10 text-fog">{staff.length} member{staff.length !== 1 ? 's' : ''}</span>
          <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-2 text-xs">
            <PlusIcon /> Add Staff
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fog pointer-events-none"><SearchIcon /></span>
          <input
            type="text"
            className="field pl-9 text-sm w-full"
            placeholder="Search name, email, position…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-fog hover:text-ink transition-colors">
              <XIcon />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {depts.map(d => (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              className={`px-3 py-1.5 rounded-full border text-10 font-bold tracking-widests uppercase transition-all
                ${deptFilter === d
                  ? 'bg-cyan/15 border-cyan/40 text-cyan'
                  : 'border-rim/50 text-fog hover:border-rim hover:text-fog-hi'
                }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-fog text-sm">Loading staff…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-fog text-sm">No staff found.</p>
          {search && (
            <button onClick={() => setSearch('')} className="text-10 font-bold tracking-widest uppercase text-cyan hover:opacity-80 transition-opacity">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
            {visible.map(emp => (
              <StaffCard key={emp.id} emp={emp} onClick={() => setSelected(emp)} />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <ProfileModal
          emp={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
      {adding && (
        <AddStaffModal
          onClose={() => setAdding(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}

// ── Staff card ─────────────────────────────────────────────────────────────────
function StaffCard({ emp, onClick }) {
  const color       = DEPT_COLOR[emp.department];
  const avatarStyle = DEPT_AVATAR[emp.department] ?? 'border-rim/50 text-fog-hi';
  const pillStyle   = DEPT_PILL[emp.department]   ?? 'bg-rim/20 border-rim/40 text-fog';

  return (
    <button
      onClick={onClick}
      className="panel text-left overflow-hidden hover:border-rim/80 transition-all group/card flex"
    >
      {/* Dept color bar — left edge */}
      <div className={`w-1 self-stretch shrink-0 ${color?.bar ?? 'bg-rim/40'}`} />

      {/* Card body */}
      <div className="flex items-center gap-3.5 px-4 py-3.5 flex-1 min-w-0">

        {/* Avatar + status dot */}
        <div className="relative shrink-0">
          <div className={`w-12 h-12 rounded-full border-2 ${avatarStyle} flex items-center justify-center overflow-hidden font-heading font-black text-lg bg-deep`}>
            {emp.photoUrl
              ? <img src={emp.photoUrl} className="w-full h-full object-cover" alt={emp.name} />
              : <span>{emp.avatar}</span>
            }
          </div>
          <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-deep
            ${emp.isLocked ? 'bg-amber-400' : emp.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>

        {/* Name / position / dept */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink leading-tight line-clamp-1">{emp.name}</p>
          <p className="text-10 text-fog mt-0.5 line-clamp-1">{emp.position ?? 'No position'}</p>
          {emp.department && (
            <span className={`inline-block text-10 font-bold tracking-widests uppercase px-2 py-0.5 rounded-full border mt-1.5 ${pillStyle}`}>
              {emp.department}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Profile modal — nearly full-screen, wraps shared content ──────────────────
function ProfileModal({ emp, onClose, onUpdated, onDeleted }) {
  const { user: currentUser } = useAuth();
  const backdropRef = useRef(null);

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 bg-void/75 backdrop-blur-sm flex items-center justify-center p-8"
    >
      <div className="w-full max-w-6xl bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden" style={{ height: '70vh' }}>
        <StaffProfileContent
          emp={emp}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          currentUser={currentUser}
          onClose={onClose}
          popoutHref={`/staff/profile/${emp.id}`}
        />
      </div>
    </div>
  );
}

// ── Add Staff modal ───────────────────────────────────────────────────────────
function AddStaffModal({ onClose, onAdded }) {
  const backdropRef = useRef(null);

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', department: '', position: '', hireDate: '', password: '',
  });
  const [checking, setChecking] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [confirm, setConfirm]         = useState(null);
  const [linkNetchex, setLinkNetchex] = useState('');

  function handleBackdrop(e) {
    if (e.target === backdropRef.current && !confirm) onClose();
  }

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.department || !form.password) {
      setError('First name, last name, email, department, and password are required.'); return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.'); return;
    }

    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    setChecking(true);
    try {
      const { data } = await api.get('/admin/staff/check', {
        params: { name: fullName, email: form.email.trim() },
      });
      if (data.emailMatch) {
        setError(`An account with this email already exists (${data.emailMatch.name} — ${data.emailMatch.department}).`);
        setChecking(false);
        return;
      }
      if (data.nameMatches?.length || data.netchexMatches?.length) {
        setConfirm({ nameMatches: data.nameMatches ?? [], netchexMatches: data.netchexMatches ?? [] });
        if (data.netchexMatches?.length) setLinkNetchex(data.netchexMatches[0].employeeName);
        setChecking(false);
        return;
      }
    } catch {}
    setChecking(false);
    await createProfile(null);
  }

  async function createProfile(overrideLinkNetchex) {
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    setSaving(true);
    try {
      const { data } = await api.post('/admin/staff', {
        name:            fullName,
        email:           form.email.trim().toLowerCase(),
        phone:           form.phone.trim() || null,
        position:        form.position.trim() || null,
        department:      form.department,
        hireDate:        form.hireDate || null,
        password:        form.password,
        linkNetchexName: overrideLinkNetchex ?? linkNetchex ?? null,
      });
      onAdded(data.employee);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create staff member.');
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  }

  // ── Confirm step ──────────────────────────────────────────────────────────
  if (confirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm">
        <div className="w-full max-w-md mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-shell/60 border-b border-rim/40 px-6 py-4">
            <h2 className="font-heading font-black text-ink text-lg leading-none">Review Before Creating</h2>
            <p className="text-10 text-fog mt-1">{form.firstName.trim()} {form.lastName.trim()} — {form.email.trim()}</p>
          </div>
          <div className="p-6 space-y-4">
            {confirm.nameMatches.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-500/25">
                <span className="text-amber-400 shrink-0 mt-0.5"><WarnIcon /></span>
                <div>
                  <p className="text-xs font-semibold text-amber-300">Similar name already exists</p>
                  <p className="text-10 text-fog mt-1 mb-1.5">Make sure this isn't a duplicate account:</p>
                  {confirm.nameMatches.map(m => (
                    <p key={m.id} className="text-10 text-fog-hi font-semibold">
                      {m.name} &mdash; {m.department}
                      <span className="font-normal text-fog"> ({m.email})</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
            {confirm.netchexMatches.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-cyan/5 border border-cyan/25">
                <span className="text-cyan shrink-0 mt-0.5"><NetchexIcon /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-cyan">Netchex records found</p>
                  <p className="text-10 text-fog mt-0.5 mb-2.5">Link one of these Netchex names to this new profile:</p>
                  <div className="space-y-2">
                    {confirm.netchexMatches.map(nx => (
                      <label key={nx.employeeName} className="flex items-center gap-2.5 cursor-pointer">
                        <input type="radio" name="netchex_confirm"
                          checked={linkNetchex === nx.employeeName}
                          onChange={() => setLinkNetchex(nx.employeeName)}
                          className="accent-cyan" />
                        <span className="text-xs text-fog-hi font-semibold">{nx.employeeName}</span>
                        <span className="text-10 text-fog">{nx.shiftCount} shift{nx.shiftCount !== 1 ? 's' : ''}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="radio" name="netchex_confirm"
                        checked={linkNetchex === ''}
                        onChange={() => setLinkNetchex('')}
                        className="accent-cyan" />
                      <span className="text-10 text-fog">Don't link any Netchex record</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
            {error && <p className="text-xs text-red-400 font-semibold">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => { setConfirm(null); setError(''); }}
                className="flex-1 btn-ghost border border-rim/60 rounded-md text-sm">
                Go Back
              </button>
              <button onClick={() => createProfile(linkNetchex || null)} disabled={saving}
                className="flex-1 btn-primary text-sm">
                {saving ? 'Creating…' : 'Create Anyway'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-shell/60 border-b border-rim/40 px-7 py-5 flex items-center justify-between">
          <div>
            <p className="label-xs mb-1">Staff / Management</p>
            <h2 className="font-heading font-black text-ink text-xl leading-none">Add Staff Member</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-ink transition-colors">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-7 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-xs block mb-2">First Name *</label>
              <input className="field text-sm" placeholder="Jane"
                value={form.firstName} onChange={set('firstName')} required autoFocus />
            </div>
            <div>
              <label className="label-xs block mb-2">Last Name *</label>
              <input className="field text-sm" placeholder="Smith"
                value={form.lastName} onChange={set('lastName')} required />
            </div>
          </div>
          <div>
            <label className="label-xs block mb-2">Email *</label>
            <input className="field text-sm" type="email" placeholder="jane@soaknfun.com"
              value={form.email} onChange={set('email')} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-xs block mb-2">Department *</label>
              <select className="field text-sm" value={form.department} onChange={set('department')} required>
                <option value="">— Select department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label-xs block mb-2">Position</label>
              <input className="field text-sm" placeholder="e.g. Lifeguard II"
                value={form.position} onChange={set('position')} />
            </div>
            <div>
              <label className="label-xs block mb-2">Phone</label>
              <input className="field text-sm" placeholder="(225) 555-0100"
                value={form.phone} onChange={set('phone')} />
            </div>
            <div>
              <label className="label-xs block mb-2">Hire Date</label>
              <input className="field text-sm" type="date"
                value={form.hireDate} onChange={set('hireDate')} />
            </div>
          </div>
          <div>
            <label className="label-xs block mb-2">Temporary Password *</label>
            <input className="field text-sm" type="password" placeholder="Min. 6 characters"
              value={form.password} onChange={set('password')} required />
            <p className="text-10 text-fog mt-1.5">
              Staff member will be prompted to set a new password on first sign-in.
            </p>
          </div>
          {error && <p className="text-xs text-red-400 font-semibold">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 btn-ghost border border-rim/60 rounded-md text-sm">
              Cancel
            </button>
            <button type="submit" disabled={checking || saving}
              className="flex-1 btn-primary text-sm flex items-center justify-center gap-2">
              {checking ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking…</>
              ) : saving ? 'Creating…' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Icons (for this page only) ────────────────────────────────────────────────
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function NetchexIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14l2 2 4-4" />
    </svg>
  );
}
