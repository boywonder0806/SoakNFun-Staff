import { useFilters } from '../context/FiltersContext.jsx';

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const PARKS = [
  { value: 'ALL', label: 'Both Parks' },
  { value: 'BB', label: 'Blue Bayou' },
  { value: 'GI', label: 'Gulf Islands' },
];

export default function FilterBar() {
  const { startDate, endDate, park, setStartDate, setEndDate, setPark, setPreset } = useFilters();

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
        {PRESETS.map(p => (
          <button
            key={p.days}
            onClick={() => setPreset(p.days)}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-700"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-700"
        />
      </div>

      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
        {PARKS.map(p => (
          <button
            key={p.value}
            onClick={() => setPark(p.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              park === p.value ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
