export function Spinner({ className = 'w-4 h-4' }) {
  return <span className={`${className} inline-block border-2 border-az/25 border-t-az rounded-full animate-spin`} />;
}

// Dim-and-spin overlay for refetches: the stale content stays visible
// underneath so the layout doesn't jump, while the pill makes it obvious a
// refresh is running. Parent must be `relative`.
export default function LoadingOverlay({ show, label = 'Reviewing the data…' }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-20 bg-slate-100/50 backdrop-blur-[1px] flex items-start justify-center pt-28 rounded-2xl">
      <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-full px-4 py-2 shadow-lg text-sm text-gray-600 sticky top-24">
        <Spinner />
        {label}
      </div>
    </div>
  );
}

// Centered spinner block for first loads, when there's no stale content to
// keep on screen.
export function LoadingBlock({ label = 'Reviewing the data…', h = 'h-72' }) {
  return (
    <div className={`${h} flex items-center justify-center gap-2.5 text-sm text-gray-500`}>
      <Spinner />
      {label}
    </div>
  );
}
