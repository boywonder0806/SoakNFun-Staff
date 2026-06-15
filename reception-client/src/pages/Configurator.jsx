import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';

const SUB_TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'faq',       label: 'FAQ' },
  { id: 'handlers',  label: 'Callback Handlers' },
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
    setTemplates(prev => [...prev, { id: `new_${Date.now()}`, label: '', body: '' }]);

  const save = async () => {
    const invalid = templates.filter(t => !t.label?.trim() || !t.body?.trim());
    if (invalid.length) return showToast('All templates must have a label and body.', 'error');
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
            <div className="pl-7">
              <textarea
                className="field text-sm text-gray-600 resize-none"
                rows={2}
                placeholder="Message body…"
                value={t.body || ''}
                onChange={e => updateTemplate(t.id, 'body', e.target.value)}
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
