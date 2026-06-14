import { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { DEPT_COLOR } from '../components/Layout/Sidebar.jsx';

const DEPARTMENTS = ['Aquatics', 'Guest Services', 'Food & Beverage', 'Cleaning Crew'];

const DEPT_PILL = {
  'Aquatics':        'bg-aq/10 border-aq/30 text-aq',
  'Guest Services':  'bg-gs/10 border-gs/30 text-gs',
  'Food & Beverage': 'bg-fb/10 border-fb/30 text-fb',
  'Cleaning Crew':   'bg-cc/10 border-cc/30 text-cc',
  'Management':      'bg-mgmt/10 border-mgmt/30 text-mgmt',
};

function canPost(role) {
  return role === 'manager' || role === 'sysadmin';
}

export default function Announcements() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [deptFilter, setDeptFilter]       = useState('all');
  const [showForm, setShowForm]           = useState(false);
  const [editTarget, setEditTarget]       = useState(null);

  useEffect(() => {
    fetchAnnouncements();
  }, [deptFilter]);

  function fetchAnnouncements() {
    setLoading(true);
    const params = deptFilter !== 'all' ? { department: deptFilter } : {};
    api.get('/announcements', { params })
      .then(r => setAnnouncements(r.data.announcements))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  function handlePosted(ann) {
    setAnnouncements(prev => [ann, ...prev]);
    setShowForm(false);
  }

  function handleUpdated(ann) {
    setAnnouncements(prev => prev.map(a => a.id === ann.id ? ann : a));
    setEditTarget(null);
  }

  function handleDeleted(id) {
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  }

  const isManager = canPost(user?.role);

  return (
    <div className="flex flex-col gap-5" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Header */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <p className="label-xs mb-1">{format(new Date(), 'EEEE, MMMM d · yyyy')}</p>
          <h1 className="font-heading font-black text-ink text-3xl leading-none uppercase tracking-tight">
            Bulletin Board
          </h1>
        </div>
        {isManager && (
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="btn-primary text-sm"
          >
            + Post Announcement
          </button>
        )}
      </div>

      {/* Department filter — crew members only see their own departments */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <FilterPill label="All" active={deptFilter === 'all'} onClick={() => setDeptFilter('all')} />
        {(isManager ? DEPARTMENTS : DEPARTMENTS.filter(d => user?.departments?.includes(d))).map(d => (
          <FilterPill
            key={d}
            label={d}
            active={deptFilter === d}
            activeClass={DEPT_PILL[d]}
            onClick={() => setDeptFilter(deptFilter === d ? 'all' : d)}
          />
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : announcements.length === 0 ? (
          <div className="panel p-10 text-center">
            <p className="text-fog text-sm">No announcements{deptFilter !== 'all' ? ' for this department' : ''}.</p>
            {isManager && (
              <button onClick={() => setShowForm(true)} className="mt-3 text-10 font-bold tracking-widest uppercase text-cyan hover:text-cyan-light transition-colors">
                Post the first one
              </button>
            )}
          </div>
        ) : (
          announcements.map(a => (
            <AnnouncementCard
              key={a.id}
              a={a}
              isManager={isManager}
              onEdit={() => { setEditTarget(a); setShowForm(true); }}
              onDelete={() => handleDeleted(a.id)}
            />
          ))
        )}
      </div>

      {/* Post / Edit modal */}
      {showForm && (
        <AnnouncementModal
          initial={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onPosted={handlePosted}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

// ── Announcement card ─────────────────────────────────────────────────────────
function AnnouncementCard({ a, isManager, onEdit, onDelete }) {
  const [expanded, setExpanded]     = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isHigh = a.priority === 'high';
  const isNew  = a.date >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const dc     = a.department ? DEPT_COLOR[a.department] : null;
  const long   = a.body.length > 200;

  async function handleDelete() {
    if (!window.confirm('Delete this announcement? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.delete(`/announcements/${a.id}`);
      onDelete();
    } catch (err) {
      console.error(err);
      setDeleting(false);
    }
  }

  return (
    <div className={`relative panel overflow-hidden transition-all ${isHigh ? 'border-red-500/30' : ''}`}
      style={dc ? { boxShadow: `0 0 24px ${dc.glow}` } : undefined}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${isHigh ? 'bg-red-400' : dc ? dc.bar : 'bg-rim/60'}`} />

      <div className="pl-5 pr-5 py-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-heading font-bold text-base leading-snug ${isHigh ? 'text-red-300' : 'text-ink'}`}>
              {a.title}
            </h3>
            {isHigh && (
              <span className="text-10 font-bold tracking-widests uppercase px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/25 text-red-400">
                Important
              </span>
            )}
            {isNew && !isHigh && (
              <span className="text-10 font-bold tracking-widests uppercase px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/20 text-cyan">
                New
              </span>
            )}
            {a.department ? (
              <span className={`text-10 font-bold tracking-widests uppercase px-2 py-0.5 rounded-full border ${DEPT_PILL[a.department] ?? 'bg-shell border-rim text-fog'}`}>
                {a.department}
              </span>
            ) : (
              <span className="text-10 font-bold tracking-widests uppercase px-2 py-0.5 rounded-full bg-shell border border-rim/60 text-fog">
                All Staff
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-10 text-fog whitespace-nowrap">{format(parseISO(a.date), 'MMM d, yyyy')}</span>
            {isManager && (
              <div className="flex gap-1">
                <button
                  onClick={onEdit}
                  className="p-1.5 rounded-md text-fog hover:text-fog-hi hover:bg-shell transition-colors"
                  title="Edit"
                >
                  <PencilIcon />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="p-1.5 rounded-md text-fog hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  title="Delete"
                >
                  {deleting ? '…' : <TrashIcon />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <p className={`text-sm text-fog-hi leading-relaxed ${!expanded && long ? 'line-clamp-3' : ''}`}>
          {a.body}
        </p>
        {long && (
          <button
            onClick={() => setExpanded(e => !e)}
            className={`text-10 font-bold tracking-widests uppercase mt-2 transition-colors ${isHigh ? 'text-red-400 hover:text-red-300' : 'text-cyan hover:text-cyan-light'}`}
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-rim/30">
          <div className="w-6 h-6 rounded-full bg-shell border border-rim flex items-center justify-center text-10 font-heading font-bold text-fog-hi shrink-0">
            {a.authorAvatar}
          </div>
          <span className="text-10 text-fog">{a.author}</span>
        </div>
      </div>
    </div>
  );
}

// ── Post / Edit modal ─────────────────────────────────────────────────────────
function AnnouncementModal({ initial, onClose, onPosted, onUpdated }) {
  const backdropRef = useRef(null);
  const isEdit = !!initial;

  const [title, setTitle]       = useState(initial?.title ?? '');
  const [body, setBody]         = useState(initial?.body ?? '');
  const [department, setDept]   = useState(initial?.department ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 'normal');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!title.trim() || !body.trim()) { setError('Title and body are required.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const { data } = await api.patch(`/announcements/${initial.id}`, {
          title, body, department: department || null, priority,
        });
        onUpdated(data.announcement);
      } else {
        const { data } = await api.post('/announcements', {
          title, body, department: department || null, priority,
        });
        onPosted(data.announcement);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save announcement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40 bg-shell/40">
          <h2 className="font-heading font-black text-ink text-lg">
            {isEdit ? 'Edit Announcement' : 'Post Announcement'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-shell hover:bg-rim/60 border border-rim/60 flex items-center justify-center text-fog hover:text-ink transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label-xs block mb-2">Title</label>
            <input
              className="field"
              placeholder="Announcement title…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label-xs block mb-2">Message</label>
            <textarea
              className="field resize-none leading-relaxed"
              rows={5}
              placeholder="Write your announcement here…"
              value={body}
              onChange={e => setBody(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-xs block mb-2">Department</label>
              <select
                className="field"
                value={department}
                onChange={e => setDept(e.target.value)}
              >
                <option value="">All Staff</option>
                {DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-xs block mb-2">Priority</label>
              <div className="flex gap-2 mt-1">
                {['normal', 'high'].map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 py-2.5 rounded-lg border text-xs font-bold tracking-wide transition-all capitalize
                      ${priority === p
                        ? p === 'high'
                          ? 'bg-red-500/15 border-red-500/40 text-red-300'
                          : 'bg-shell border-fog-hi/40 text-ink'
                        : 'bg-transparent border-rim/50 text-fog hover:border-rim'
                      }`}
                  >
                    {p === 'high' ? '! Important' : 'Normal'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 font-semibold">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="btn-ghost border border-rim/60 rounded-md flex-1">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Post Announcement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function FilterPill({ label, active, activeClass, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-10 font-bold tracking-widests uppercase transition-all
        ${active
          ? activeClass ?? 'bg-shell border-fog-hi/40 text-ink'
          : 'bg-transparent border-rim/50 text-fog hover:border-rim hover:text-fog-hi'
        }`}
    >
      {label}
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="panel p-5 animate-pulse space-y-3">
      <div className="h-4 w-2/3 bg-shell rounded" />
      <div className="h-3 w-full bg-shell rounded" />
      <div className="h-3 w-4/5 bg-shell rounded" />
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
