import { useEffect, useState } from 'react';

export function Spinner({ className = 'w-4 h-4' }) {
  return <span className={`${className} inline-block border-2 border-az/25 border-t-az rounded-full animate-spin`} />;
}

// ── Adaptive load progress ────────────────────────────────────────────────────
// There's no server-side progress signal, so the bar is paced against how
// long this page's load ACTUALLY took last time: each completed load feeds
// an EMA per pathname (localStorage), and the bar approaches 100%
// asymptotically against that estimate — ~85% at the expected duration,
// creeping to 97% until the data really lands. First visit falls back to 5s.

function expectedMs(key) {
  const v = parseFloat(localStorage.getItem(`loadms:${key}`));
  return isFinite(v) && v > 300 ? v : 5000;
}

function recordMs(key, ms) {
  if (ms < 100) return; // instant cache paints shouldn't drag the estimate down
  const prev = parseFloat(localStorage.getItem(`loadms:${key}`));
  const ema = isFinite(prev) && prev > 0 ? prev * 0.6 + ms * 0.4 : ms;
  localStorage.setItem(`loadms:${key}`, String(Math.round(ema)));
}

// Mounted for exactly the duration of one load — mount starts the clock,
// unmount records the real duration as the new estimate.
function useLoadProgress() {
  const key = window.location.pathname;
  const [state, setState] = useState({ progress: 0, remaining: null });

  useEffect(() => {
    const start = Date.now();
    const expected = expectedMs(key);
    const tick = () => {
      const elapsed = Date.now() - start;
      setState({
        progress: Math.min(0.97, 1 - Math.exp(-(elapsed / expected) * 1.9)),
        remaining: Math.max(0, Math.ceil((expected * 1.15 - elapsed) / 1000)),
      });
    };
    tick();
    const t = setInterval(tick, 120);
    return () => {
      clearInterval(t);
      recordMs(key, Date.now() - start);
    };
  }, [key]);

  return state;
}

function ProgressPill({ label, className = '' }) {
  const { progress, remaining } = useLoadProgress();
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-lg w-72 ${className}`}>
      <div className="flex items-center gap-2.5 text-sm text-gray-600">
        <Spinner />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-xs tabular-nums text-gray-400">{Math.round(progress * 100)}%</span>
      </div>
      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-az rounded-full transition-[width] duration-150 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">
        {remaining > 0 ? `about ${remaining}s left` : 'almost done…'}
      </p>
    </div>
  );
}

// Dim-and-progress overlay for refetches: the stale content stays visible
// underneath so the layout doesn't jump. Parent must be `relative`.
// ProgressPill must mount/unmount with `show` so the load timer is honest.
export default function LoadingOverlay({ show, label = 'Reviewing the data…' }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-20 bg-slate-100/50 backdrop-blur-[1px] flex items-start justify-center pt-28 rounded-2xl">
      <ProgressPill label={label} className="sticky top-24" />
    </div>
  );
}

// Centered progress block for first loads, when there's no stale content to
// keep on screen.
export function LoadingBlock({ label = 'Reviewing the data…', h = 'h-72' }) {
  return (
    <div className={`${h} flex items-center justify-center`}>
      <ProgressPill label={label} />
    </div>
  );
}
