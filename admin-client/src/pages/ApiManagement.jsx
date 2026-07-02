import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';

const STATUS_META = {
  operational:    { dot: 'bg-emerald-500', label: 'Operational',    text: 'text-emerald-600' },
  degraded:       { dot: 'bg-amber-500',   label: 'Degraded',       text: 'text-amber-600' },
  down:           { dot: 'bg-red-500',     label: 'Unreachable',    text: 'text-red-600' },
  not_configured: { dot: 'bg-gray-300',    label: 'Not Configured', text: 'text-gray-400' },
};

function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export default function ApiManagement() {
  const [data, setData]       = useState(null);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const [integrations, bill] = await Promise.all([
        api.get(`/admin/integrations${refresh ? '?refresh=1' : ''}`),
        api.get('/admin/integrations/anthropic-billing'),
      ]);
      setData(integrations.data);
      setBilling(bill.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkedAt = data?.checkedAt
    ? new Date(data.checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null;

  const summary = data?.integrations?.reduce((s, i) => {
    s[i.status] = (s[i.status] || 0) + 1;
    return s;
  }, {}) || {};

  return (
    <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3 animate-fade-up">
        <div className="flex items-center gap-4 bg-white rounded-2xl border border-gray-200 px-5 py-3 flex-1 min-w-[280px]">
          {['operational', 'degraded', 'down', 'not_configured'].map(k => (
            <span key={k} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <span className={`w-2 h-2 rounded-full ${STATUS_META[k].dot}`} />
              {summary[k] || 0} {STATUS_META[k].label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {checkedAt && <span className="text-xs text-gray-400">Checked {checkedAt}</span>}
          <button onClick={() => load(true)} disabled={loading} className="btn-ghost text-xs py-2.5">
            <RefreshIcon spinning={loading} /> Run Checks
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-600 text-center">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex flex-col items-center justify-center h-56 bg-white rounded-2xl border border-gray-200 gap-3">
          <div className="w-6 h-6 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
          <p className="text-xs text-gray-400">Checking every integration — this takes a few seconds</p>
        </div>
      ) : data && (
        <div className="grid sm:grid-cols-2 gap-4">
          {data.integrations.map(integration => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              billing={integration.id === 'anthropic' ? billing : null}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center pb-4">
        Statuses are checked live against each provider and cached for 30 seconds. Billing figures refresh every 5 minutes.
      </p>
    </div>
  );
}

function IntegrationCard({ integration: it, billing }) {
  const meta = STATUS_META[it.status] || STATUS_META.down;

  return (
    <div className={`bg-white rounded-2xl border p-5 flex flex-col gap-4 ${it.status === 'down' ? 'border-red-200' : 'border-gray-200'}`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{it.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{it.description}</p>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
            <span className={`w-2 h-2 rounded-full ${meta.dot} ${it.status === 'operational' ? 'animate-pulse' : ''}`} />
            {meta.label}
          </span>
          {it.status !== 'not_configured' && it.latencyMs != null && (
            <p className="text-[11px] text-gray-400 mt-1">{it.latencyMs} ms</p>
          )}
        </div>
      </div>

      {/* Error */}
      {it.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">{it.error}</p>
      )}

      {/* Details */}
      {it.details && Object.keys(it.details).length > 0 && (
        <div className="space-y-1.5">
          {Object.entries(it.details).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-gray-400 shrink-0">{k}</span>
              <span className="text-gray-700 font-medium text-right">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Billing (Anthropic only) */}
      {it.hasBilling && billing && (
        <div className="border-t border-gray-100 pt-4 mt-auto">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Usage & Billing</p>

          {!billing.configured ? (
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 leading-relaxed">
              {billing.hint}
            </p>
          ) : billing.error ? (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">{billing.error}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <BillingStat label={`Spend · ${billing.month}`} value={billing.costUsd != null ? `$${billing.costUsd.toFixed(2)}` : '—'} accent />
                <BillingStat label="Input Tokens" value={fmtTokens(billing.tokens?.input)} />
                <BillingStat label="Output Tokens" value={fmtTokens(billing.tokens?.output)} />
              </div>
              {billing.tokens?.cacheRead > 0 && (
                <p className="text-[11px] text-gray-400 mb-2">
                  Plus {fmtTokens(billing.tokens.cacheRead)} cached input tokens served at ~10% of the normal rate.
                </p>
              )}
              <p className="text-[11px] text-gray-400 leading-relaxed">{billing.note}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BillingStat({ label, value, accent }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${accent ? 'bg-orange-50/60 border-orange-100' : 'bg-gray-50 border-gray-100'}`}>
      <p className={`text-sm font-bold ${accent ? 'text-admin' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
