import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../../../lib/api.js';

const DEPT_META = [
  {
    id: 'aquatics',
    name: 'Aquatics',
    colorClass: 'text-aq',
    barClass: 'bg-aq',
    borderClass: 'border-aq/40',
    bgClass: 'bg-aq/10',
    description: 'Pool and water attraction safety and operations. Staff are responsible for guest safety across all aquatic areas.',
  },
  {
    id: 'guest_services',
    name: 'Guest Services',
    colorClass: 'text-gs',
    barClass: 'bg-gs',
    borderClass: 'border-gs/40',
    bgClass: 'bg-gs/10',
    description: 'Guest experience, ticketing, and park entry operations. First point of contact for all park visitors.',
  },
  {
    id: 'food_beverage',
    name: 'Food & Beverage',
    colorClass: 'text-fb',
    barClass: 'bg-fb',
    borderClass: 'border-fb/40',
    bgClass: 'bg-fb/10',
    description: 'Food stands, concessions, and beverage service throughout the park.',
  },
  {
    id: 'cleaning_crew',
    name: 'Cleaning Crew',
    colorClass: 'text-cc',
    barClass: 'bg-cc',
    borderClass: 'border-cc/40',
    bgClass: 'bg-cc/10',
    description: 'Park-wide cleanliness, sanitation, and waste management to ensure a safe and welcoming environment.',
  },
];

export default function SysAdminDepartments() {
  const [allEntries, setAllEntries]     = useState([]);
  const [descriptions, setDescriptions] = useState(
    Object.fromEntries(DEPT_META.map(d => [d.id, d.description]))
  );
  const [selectedId, setSelectedId] = useState('aquatics');
  const [loading, setLoading]       = useState(true);
  const [dragState, setDragState]   = useState({ from: null, over: null });

  useEffect(() => {
    api.get('/admin/departments/roles')
      .then(r => setAllEntries(r.data.roles.filter(e => e.type === 'position')))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const departments = DEPT_META.map(meta => {
    const positions = allEntries.filter(e => e.department === meta.name);
    return { ...meta, description: descriptions[meta.id], positions };
  });

  const dept = departments.find(d => d.id === selectedId);

  async function addPosition(deptName, name, schedulingNotes = null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const { data } = await api.post(
        `/admin/departments/${encodeURIComponent(deptName)}/roles`,
        { name: trimmed, type: 'position', schedulingNotes: schedulingNotes || null }
      );
      setAllEntries(prev => [...prev, data.role]);
    } catch (err) {
      console.error(err);
    }
  }

  async function updateEntry(id, fields) {
    try {
      const { data } = await api.patch(`/admin/departments/roles/${id}`, fields);
      setAllEntries(prev => prev.map(e => e.id === id ? data.role : e));
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteEntry(id) {
    try {
      await api.delete(`/admin/departments/roles/${id}`);
      setAllEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  const reorderPositions = useCallback(async (deptName, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const deptPositions = allEntries.filter(e => e.department === deptName);
    const reordered = [...deptPositions];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const otherEntries = allEntries.filter(e => e.department !== deptName);
    setAllEntries([...otherEntries, ...reordered]);
    try {
      await api.patch('/admin/departments/roles/reorder', {
        items: reordered.map((e, i) => ({ id: e.id, sortOrder: i })),
      });
    } catch (err) {
      console.error(err);
      api.get('/admin/departments/roles')
        .then(r => setAllEntries(r.data.roles.filter(e => e.type === 'position')));
    }
  }, [allEntries]);

  return (
    <div className="flex flex-col gap-5" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Header */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <p className="label-xs mb-1">System Admin / Departments</p>
          <h1 className="font-heading font-black text-ink text-3xl leading-none uppercase tracking-tight">
            Departments
          </h1>
        </div>
        {!loading && (
          <span className="text-10 text-fog pb-1">{allEntries.length} positions</span>
        )}
      </div>

      <div className="flex-1 grid grid-cols-3 gap-5 min-h-0">

        {/* Left — department list */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">
          {departments.map(d => {
            const isActive = d.id === selectedId;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left rounded-xl border px-4 py-3.5 transition-all relative overflow-hidden
                  ${isActive
                    ? `${d.bgClass} ${d.borderClass} ring-1 ring-inset ring-current/10`
                    : 'bg-shell/30 border-rim/40 hover:bg-shell/60 hover:border-rim/60'
                  }`}
              >
                {isActive && <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${d.barClass}`} />}
                <div className="flex items-center justify-between pl-1 mb-1.5">
                  <span className={`text-sm font-bold ${isActive ? d.colorClass : 'text-ink'}`}>{d.name}</span>
                  <span className="text-10 text-fog">{d.positions.length}P</span>
                </div>
                <div className="flex flex-wrap gap-1 pl-1">
                  {d.positions.slice(0, 3).map(p => (
                    <span key={p.id} className="text-10 text-fog bg-shell/60 border border-rim/40 rounded px-1.5 py-0.5">
                      {p.name}
                    </span>
                  ))}
                  {d.positions.length > 3 && (
                    <span className="text-10 text-fog">+{d.positions.length - 3}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right — department config */}
        {dept && (
          <div className="col-span-2 panel p-6 flex flex-col gap-6 min-h-0 overflow-y-auto">

            {/* Dept header */}
            <div className="flex items-start gap-4">
              <div className={`w-1 self-stretch rounded-full ${dept.barClass} shrink-0`} />
              <div className="flex-1">
                <h2 className={`font-heading font-black text-2xl leading-none mb-1 ${dept.colorClass}`}>{dept.name}</h2>
                <DescriptionEditor
                  value={dept.description}
                  onChange={val => setDescriptions(prev => ({ ...prev, [dept.id]: val }))}
                />
              </div>
            </div>

            {/* AI notes callout */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
              <SparkleIcon className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
              <p className="text-xs text-fog-hi leading-relaxed">
                Each position is <span className="text-ink font-semibold">one slot per day</span>. Add{' '}
                <span className="text-violet-300 font-semibold">scheduling notes</span> to any position and the
                auto-scheduler will treat them as hard constraints — shift times, early cuts, demand patterns, and more.
              </p>
            </div>

            {loading ? (
              <p className="text-fog text-sm py-4 text-center">Loading…</p>
            ) : (
              <div className="flex flex-col gap-3">

                {dept.positions.length === 0 && (
                  <p className="text-fog text-sm py-3 text-center">No positions yet — add one below.</p>
                )}

                {dept.positions.map((entry, idx) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    index={idx + 1}
                    dept={dept}
                    onUpdate={fields => updateEntry(entry.id, fields)}
                    onDelete={() => deleteEntry(entry.id)}
                    onDuplicate={() => addPosition(dept.name, `${entry.name} (copy)`, entry.schedulingNotes)}
                    isDragging={dragState.from === idx}
                    isDragOver={dragState.over === idx && dragState.from !== null && dragState.from !== idx}
                    onDragStart={() => setDragState(s => ({ ...s, from: idx }))}
                    onDragOver={() => setDragState(s => ({ ...s, over: idx }))}
                    onDrop={() => {
                      if (dragState.from !== null && dragState.from !== idx) {
                        reorderPositions(dept.name, dragState.from, idx);
                      }
                      setDragState({ from: null, over: null });
                    }}
                    onDragEnd={() => setDragState({ from: null, over: null })}
                  />
                ))}

                <AddEntryInput dept={dept} onAdd={name => addPosition(dept.name, name)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────
function EntryRow({ entry, index, dept, onUpdate, onDelete, onDuplicate, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const [editing, setEditing]           = useState(false);
  const [name, setName]                 = useState(entry.name);
  const [schedulingNotes, setNotes]     = useState(entry.schedulingNotes ?? '');
  const nameRef = useRef(null);

  useEffect(() => {
    setName(entry.name);
    setNotes(entry.schedulingNotes ?? '');
  }, [entry]);

  useEffect(() => { if (editing) nameRef.current?.focus(); }, [editing]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) { setName(entry.name); setEditing(false); return; }
    onUpdate({ name: trimmed, schedulingNotes: schedulingNotes.trim() || null });
    setEditing(false);
  }

  function cancel() {
    setName(entry.name);
    setNotes(entry.schedulingNotes ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className={`rounded-xl border px-4 py-4 flex flex-col gap-3 ${dept.bgClass} ${dept.borderClass}`}>
        <div className="flex items-center gap-2">
          <span className="text-10 text-fog font-mono w-5 text-center shrink-0">{String(index).padStart(2, '0')}</span>
          <input
            ref={nameRef}
            className="flex-1 bg-transparent text-sm font-semibold text-ink outline-none border-b border-current/40 pb-0.5"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') cancel(); }}
            placeholder="Position name"
          />
        </div>

        <div className="pl-7 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <SparkleIcon className="w-3 h-3 text-violet-400" />
              <label className="text-10 text-violet-300 uppercase tracking-widest font-bold">Scheduling Notes</label>
            </div>
            <textarea
              className="field text-xs resize-none w-full leading-relaxed"
              rows={3}
              placeholder="Describe scheduling requirements for this position. e.g. 'Typically cut early in the afternoon once guest demand drops. On weekends, start at 8:45 AM instead of 9 AM.' The auto-scheduler reads these as binding instructions."
              value={schedulingNotes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={cancel} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={commit}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${dept.bgClass} ${dept.borderClass} ${dept.colorClass} hover:opacity-80`}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasNotes = !!entry.schedulingNotes?.trim();

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`rounded-lg border px-3 py-2 transition-all group
        ${isDragging ? 'opacity-40 cursor-grabbing bg-shell/60 border-rim/60' : 'bg-shell/40 hover:bg-shell/60'}
        ${isDragOver ? 'border-cyan/50 border-t-2' : isDragging ? 'border-rim/60' : 'border-rim/40 hover:border-rim/70'}
      `}
    >
      <div className="flex items-center gap-2">
        <span className="text-fog/20 group-hover:text-fog/50 transition-colors shrink-0 cursor-grab active:cursor-grabbing">
          <DragIcon />
        </span>

        <button className="flex-1 text-left min-w-0 flex items-center gap-2" onClick={() => setEditing(true)}>
          <p className="text-xs font-semibold text-ink leading-none">{entry.name}</p>
          {hasNotes ? (
            <div className="flex items-center gap-1 min-w-0">
              <SparkleIcon className="w-2.5 h-2.5 text-violet-400 shrink-0" />
              <p className="text-10 text-fog truncate">{entry.schedulingNotes}</p>
            </div>
          ) : (
            <p className="text-10 text-fog/30 italic opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              Add notes…
            </p>
          )}
        </button>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded-md text-fog hover:text-fog-hi hover:bg-shell transition-colors"
            title="Edit"
          >
            <PencilIcon />
          </button>
          <button
            onClick={onDuplicate}
            className="p-1 rounded-md text-fog hover:text-cyan hover:bg-cyan/10 transition-colors"
            title="Duplicate"
          >
            <DuplicateIcon />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded-md text-fog hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add entry input ───────────────────────────────────────────────────────────
function AddEntryInput({ dept, onAdd }) {
  const [value, setValue] = useState('');

  function submit() {
    if (!value.trim()) return;
    onAdd(value);
    setValue('');
  }

  return (
    <div className={`flex gap-2 p-3 rounded-xl border border-dashed ${dept.borderClass} ${dept.bgClass}/30 mt-1`}>
      <input
        className="flex-1 bg-transparent text-sm text-ink placeholder-fog outline-none"
        placeholder={`Add a position to ${dept.name}…`}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide border transition-all
          ${value.trim()
            ? `${dept.bgClass} ${dept.borderClass} ${dept.colorClass} hover:opacity-80`
            : 'border-rim/40 text-fog cursor-not-allowed opacity-50'
          }`}
      >
        Add
      </button>
    </div>
  );
}

// ── Inline description editor ────────────────────────────────────────────────
function DescriptionEditor({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    onChange(draft.trim() || value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-fog-hi text-left leading-relaxed hover:text-ink transition-colors group w-full"
      >
        {value}
        <span className="ml-2 text-10 text-fog opacity-0 group-hover:opacity-100 tracking-widest uppercase">edit</span>
      </button>
    );
  }

  return (
    <textarea
      className="field text-sm w-full resize-none leading-relaxed"
      rows={2}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      autoFocus
    />
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function DragIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}
function SparkleIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}
function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
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
