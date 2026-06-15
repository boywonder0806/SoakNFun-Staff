import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';
import { useGrammarFix } from '../lib/useGrammarFix.js';

const SUB_TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'faq',       label: 'FAQ' },
  { id: 'handlers',  label: 'Callback Handlers' },
  { id: 'logs',      label: 'Logs' },
];

export default function Configurator() {
  const [sub, setSub] = useState('templates');

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 pt-5 pb-0 shrink-0">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Configurator</h2>
        <div className="flex gap-1">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px
                ${sub === t.id
                  ? 'border-brand text-brand bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {sub === 'templates' && <TemplatesTab />}
        {sub === 'faq'       && <FaqTab />}
        {sub === 'handlers'  && <HandlersTab />}
        {sub === 'logs'      && <LogsTab />}
      </div>
    </div>
  );
}

/* ─── Templates Tab ─── */

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api.get('/reception/config/templates')
      .then(r => setTemplates(r.data.templates || []))
      .catch(() => showToast('Failed to load templates', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const updateTemplate = (id, field, value) =>
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));

  const deleteTemplate = id =>
    setTemplates(prev => prev.filter(t => t.id !== id));

  const addTemplate = () =>
    setTemplates(prev => [...prev, { id: `new_${Date.now()}`, label: '', reason: '', notes: '' }]);

  const save = async () => {
    const invalid = templates.filter(t => !t.label?.trim() || !t.reason?.trim());
    if (invalid.length) return showToast('All templates must have a label and reason.', 'error');
    setSaving(true);
    try {
      await api.put('/reception/config/templates', { templates });
      showToast('Templates saved.');
    } catch {
      showToast('Failed to save templates.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset all templates to defaults? This cannot be undone.')) return;
    setSaving(true);
    try {
      const r = await api.post('/reception/config/reset-templates');
      setTemplates(r.data.templates || []);
      showToast('Templates reset to defaults.');
    } catch {
      showToast('Failed to reset templates.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <SectionHeader
        title="Call Templates"
        description="Quick-fill templates shown when logging a new call."
        onReset={reset}
        onSave={save}
        saving={saving}
      />

      <div className="space-y-3">
        {templates.map((t, i) => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium w-5 text-center shrink-0">{i + 1}</span>
              <input
                className="field text-sm font-medium flex-1"
                placeholder="Template label (e.g. General Inquiry)"
                value={t.label || ''}
                onChange={e => updateTemplate(t.id, 'label', e.target.value)}
              />
              <button
                type="button"
                onClick={() => deleteTemplate(t.id)}
                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                title="Remove"
              >
                <TrashIcon />
              </button>
            </div>
            <div className="pl-7 space-y-2">
              <input
                className="field text-sm text-gray-600"
                placeholder="Reason / subject (e.g. Ticket pricing inquiry)"
                value={t.reason || ''}
                onChange={e => updateTemplate(t.id, 'reason', e.target.value)}
              />
              <textarea
                className="field text-sm text-gray-500 resize-none"
                rows={2}
                placeholder="Pre-filled notes (optional — e.g. Directed to bluebayouwaterpark.com)"
                value={t.notes || ''}
                onChange={e => updateTemplate(t.id, 'notes', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addTemplate}
        className="w-full py-3 text-sm text-brand border-2 border-dashed border-brand/30 rounded-xl hover:border-brand hover:bg-brand/5 transition-colors font-medium"
      >
        + Add Template
      </button>

      {toast && <Toast {...toast} />}
    </div>
  );
}

/* ─── FAQ Tab ─── */

function FaqTab() {
  const [faqs, setFaqs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api.get('/reception/config/faqs')
      .then(r => setFaqs(r.data.faqs || []))
      .catch(() => showToast('Failed to load FAQs', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const updateFaq = (id, field, value) =>
    setFaqs(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));

  const deleteFaq = id => setFaqs(prev => prev.filter(f => f.id !== id));

  const addFaq = () =>
    setFaqs(prev => [...prev, { id: `new_${Date.now()}`, question: '', answer: '', tags: [] }]);

  const save = async () => {
    const invalid = faqs.filter(f => !f.question?.trim() || !f.answer?.trim());
    if (invalid.length) return showToast('All FAQs must have a question and answer.', 'error');
    setSaving(true);
    try {
      await api.put('/reception/config/faqs', { faqs });
      showToast('FAQs saved.');
    } catch {
      showToast('Failed to save FAQs.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset all FAQs to defaults? This cannot be undone.')) return;
    setSaving(true);
    try {
      const r = await api.post('/reception/config/reset-faqs');
      setFaqs(r.data.faqs || []);
      showToast('FAQs reset to defaults.');
    } catch {
      showToast('Failed to reset FAQs.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <SectionHeader
        title="FAQ Entries"
        description="Questions and answers shown in the FAQ panel during calls."
        onReset={reset}
        onSave={save}
        saving={saving}
      />

      <div className="space-y-3">
        {faqs.map((f, i) => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium w-5 text-center shrink-0">{i + 1}</span>
              <input
                className="field text-sm font-medium flex-1"
                placeholder="Question (e.g. What are the park hours?)"
                value={f.question || ''}
                onChange={e => updateFaq(f.id, 'question', e.target.value)}
              />
              <button
                type="button"
                onClick={() => deleteFaq(f.id)}
                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                title="Remove"
              >
                <TrashIcon />
              </button>
            </div>
            <div className="pl-7">
              <textarea
                className="field text-sm text-gray-600 resize-none"
                rows={3}
                placeholder="Answer guests receive when this is asked…"
                value={f.answer || ''}
                onChange={e => updateFaq(f.id, 'answer', e.target.value)}
              />
            </div>
            <div className="pl-7">
              <input
                className="field text-xs text-gray-500"
                placeholder="Tags (comma-separated, e.g. hours,schedule)"
                value={Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '')}
                onChange={e => updateFaq(f.id, 'tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addFaq}
        className="w-full py-3 text-sm text-brand border-2 border-dashed border-brand/30 rounded-xl hover:border-brand hover:bg-brand/5 transition-colors font-medium"
      >
        + Add FAQ
      </button>

      {toast && <Toast {...toast} />}
    </div>
  );
}

/* ─── Callback Handlers Tab ─── */

function HandlersTab() {
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toggling, setToggling] = useState(null);
  const [sending, setSending]   = useState(false);
  const [sentResult, setSentResult] = useState(null);
  const [toast, setToast]       = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const sendDigests = async () => {
    setSending(true);
    setSentResult(null);
    try {
      const r = await api.post('/reception/config/send-callback-digests');
      setSentResult(r.data.sent ?? 0);
      setTimeout(() => setSentResult(null), 5000);
    } catch {
      showToast('Failed to send digest emails.', 'error');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    api.get('/reception/config/staff')
      .then(r => setStaff(r.data.staff || []))
      .catch(() => showToast('Failed to load staff', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id, current) => {
    setToggling(id);
    try {
      const r = await api.patch(`/reception/config/staff/${id}/callback-handler`, {
        canHandle: !current,
      });
      setStaff(prev => prev.map(s => s.id === id
        ? { ...s, canHandleCallbacks: r.data.employee.canHandleCallbacks }
        : s
      ));
    } catch {
      showToast('Failed to update.', 'error');
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  const enabled  = staff.filter(s => s.canHandleCallbacks);
  const disabled = staff.filter(s => !s.canHandleCallbacks);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Callback Handlers</h3>
            <p className="text-xs text-gray-500">
              Toggle which employees can be selected as the requested callback handler when logging a call.
              {enabled.length === 0 && (
                <span className="block mt-1 text-amber-600 font-medium">
                  No handlers enabled — all active staff will appear in the dropdown as a fallback.
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-700">Send Callback Digest</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {sentResult !== null
                ? sentResult === 0
                  ? 'No pending callbacks found — no emails sent.'
                  : `Digest sent to ${sentResult} staff member${sentResult !== 1 ? 's' : ''}.`
                : 'Manually email all assigned handlers a list of their pending callbacks with a magic link to update statuses.'}
            </p>
          </div>
          <button
            type="button"
            onClick={sendDigests}
            disabled={sending}
            className="px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-dark transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1.5"
          >
            <EmailIcon />
            {sending ? 'Sending…' : sentResult !== null ? 'Sent ✓' : 'Send Now'}
          </button>
        </div>
      </div>

      {enabled.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Enabled</p>
          <div className="space-y-2">
            {enabled.map(s => <StaffRow key={s.id} staff={s} onToggle={toggle} toggling={toggling === s.id} />)}
          </div>
        </div>
      )}

      <div>
        {enabled.length > 0 && (
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Disabled</p>
        )}
        <div className="space-y-2">
          {disabled.map(s => <StaffRow key={s.id} staff={s} onToggle={toggle} toggling={toggling === s.id} />)}
        </div>
      </div>

      {toast && <Toast {...toast} />}
    </div>
  );
}

function StaffRow({ staff: s, onToggle, toggling }) {
  const initials = s.name ? s.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : '?';
  return (
    <div className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 transition-colors
      ${s.canHandleCallbacks ? 'border-brand/30 bg-brand/5' : 'border-gray-200'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
        ${s.canHandleCallbacks ? 'bg-brand/20 text-brand border border-brand/40' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
        <p className="text-xs text-gray-500 truncate">{s.position || s.department || ''}</p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(s.id, s.canHandleCallbacks)}
        disabled={toggling}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0
          ${s.canHandleCallbacks
            ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
            : 'bg-brand/10 text-brand hover:bg-brand/20 border border-brand/30'
          } disabled:opacity-50`}
      >
        {toggling ? '…' : s.canHandleCallbacks ? 'Remove' : 'Enable'}
      </button>
    </div>
  );
}

/* ─── Logs Tab ─── */

const EVENT_STYLES = {
  'Call logged':                    { dot: 'bg-blue-400',   text: 'text-blue-700'   },
  'Call marked resolved':           { dot: 'bg-gray-400',   text: 'text-gray-600'   },
  'Call reopened':                  { dot: 'bg-gray-400',   text: 'text-gray-600'   },
  'Callback marked completed':      { dot: 'bg-green-500',  text: 'text-green-700'  },
  'Callback marked unable to reach':{ dot: 'bg-red-400',    text: 'text-red-600'    },
  'Templates saved':                { dot: 'bg-brand',      text: 'text-brand'      },
  'FAQs saved':                     { dot: 'bg-brand',      text: 'text-brand'      },
  'Templates reset to defaults':    { dot: 'bg-amber-400',  text: 'text-amber-600'  },
  'FAQs reset to defaults':         { dot: 'bg-amber-400',  text: 'text-amber-600'  },
  'Callback handler enabled':       { dot: 'bg-cyan-500',   text: 'text-cyan-700'   },
  'Callback handler disabled':      { dot: 'bg-orange-400', text: 'text-orange-600' },
  'Callback digest sent':           { dot: 'bg-violet-500', text: 'text-violet-700' },
  'Reception access granted':       { dot: 'bg-cyan-500',   text: 'text-cyan-700'   },
  'Reception access revoked':       { dot: 'bg-red-400',    text: 'text-red-600'    },
  'Reception manager role granted': { dot: 'bg-violet-500', text: 'text-violet-700' },
  'Reception manager role removed': { dot: 'bg-orange-400', text: 'text-orange-600' },
  'Reception portal invite resent': { dot: 'bg-blue-400',   text: 'text-blue-700'   },
};

const EMAIL_TYPE_STYLES = {
  reception_welcome:     { label: 'Portal Welcome',   bg: 'bg-cyan-100',   text: 'text-cyan-700'   },
  callback_notification: { label: 'Callback Alert',   bg: 'bg-blue-100',   text: 'text-blue-700'   },
  callback_digest:       { label: 'Callback Digest',  bg: 'bg-violet-100', text: 'text-violet-700' },
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDate(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function LogsTab() {
  const [panel, setPanel] = useState('activity');
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-1 bg-gray-200 rounded-lg p-1 w-fit">
        {[['activity', 'Activity Log'], ['emails', 'Email Log']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors
              ${panel === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {panel === 'activity' && <ActivityLogPanel />}
      {panel === 'emails'   && <EmailLogPanel />}
    </div>
  );
}

function ActivityLogPanel() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal]     = useState(0);

  const load = async (offset = 0) => {
    setLoading(true);
    try {
      const r = await api.get(`/reception/config/activity-log?limit=100&offset=${offset}`);
      setLogs(r.data.logs || []);
      setTotal(r.data.total || 0);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Activity Log</p>
          <p className="text-xs text-gray-500 mt-0.5">All reception portal actions — {total} total</p>
        </div>
        <button onClick={() => load()} className="text-xs text-brand hover:underline">Refresh</button>
      </div>

      {logs.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">No activity yet.</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {logs.map(log => {
            const style = EVENT_STYLES[log.event] || { dot: 'bg-gray-300', text: 'text-gray-600' };
            return (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${style.text}`}>{log.event}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {log.actorName && <span className="font-medium text-gray-700">{log.actorName}</span>}
                    {log.actorName && log.employeeName && log.actorName !== log.employeeName && (
                      <span> → <span className="font-medium text-gray-700">{log.employeeName}</span></span>
                    )}
                    {!log.actorName && log.employeeName && <span className="font-medium text-gray-700">{log.employeeName}</span>}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <span className="text-gray-400">
                        {' · '}
                        {Object.entries(log.details)
                          .filter(([, v]) => v !== null && v !== false)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ')}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 mt-0.5" title={fullDate(log.createdAt)}>
                  {timeAgo(log.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmailLogPanel() {
  const [emails, setEmails]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal]     = useState(0);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/reception/config/email-log?limit=100');
      setEmails(r.data.emails || []);
      setTotal(r.data.total || 0);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Email Log</p>
            <p className="text-xs text-gray-500 mt-0.5">All reception emails sent by the system — {total} total</p>
          </div>
          <button onClick={load} className="text-xs text-brand hover:underline">Refresh</button>
        </div>

        {emails.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No emails sent yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {emails.map(e => {
              const style = EMAIL_TYPE_STYLES[e.type] || { label: e.type, bg: 'bg-gray-100', text: 'text-gray-600' };
              return (
                <button
                  key={e.id}
                  onClick={() => setPreview(e)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-0.5 ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.toName || e.toEmail}</p>
                    <p className="text-xs text-gray-500 truncate">{e.subject}</p>
                    {e.triggeredByName && (
                      <p className="text-xs text-gray-400 mt-0.5">by {e.triggeredByName}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 mt-0.5" title={fullDate(e.sentAt)}>
                    {timeAgo(e.sentAt)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {preview && <EmailPreviewModal email={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function EmailPreviewModal({ email, onClose }) {
  const style = EMAIL_TYPE_STYLES[email.type] || { label: email.type, bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${style.bg} ${style.text}`}>
                {style.label}
              </span>
              <span className="text-xs text-gray-400">{fullDate(email.sentAt)}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">{email.subject}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              To: <span className="font-medium">{email.toName || ''}</span>
              {email.toName && email.toEmail && ` <${email.toEmail}>`}
              {!email.toName && email.toEmail}
              {email.triggeredByName && <span className="ml-2 text-gray-400">· sent by {email.triggeredByName}</span>}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-hidden rounded-b-2xl">
          {email.htmlBody ? (
            <iframe
              srcDoc={email.htmlBody}
              sandbox="allow-same-origin"
              className="w-full h-full border-0"
              style={{ minHeight: '420px' }}
              title="Email preview"
            />
          ) : (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              No preview available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Shared helpers ─── */

function SectionHeader({ title, description, onReset, onSave, saving }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReset}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Reset defaults
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Toast({ msg, type }) {
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50
      ${type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
      {msg}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
