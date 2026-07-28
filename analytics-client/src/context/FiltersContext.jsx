import { createContext, useContext, useState, useMemo } from 'react';

const FiltersContext = createContext(null);

function centralToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// Shared date-range + park filter, so switching pages doesn't lose context.
// Defaults to today — the dashboard opens as a live daily report.
export function FiltersProvider({ children }) {
  const [startDate, setStartDate] = useState(centralToday());
  const [endDate, setEndDate]     = useState(centralToday());
  const [park, setPark]           = useState('ALL'); // ALL | BB | GI

  const params = useMemo(() => {
    const p = { startDate, endDate };
    if (park !== 'ALL') p.park = park;
    return p;
  }, [startDate, endDate, park]);

  function setPreset(days) {
    setEndDate(centralToday());
    setStartDate(daysAgo(days - 1));
  }

  return (
    <FiltersContext.Provider value={{ startDate, endDate, park, setStartDate, setEndDate, setPark, setPreset, params }}>
      {children}
    </FiltersContext.Provider>
  );
}

export function useFilters() {
  return useContext(FiltersContext);
}
