import { useState, useCallback } from 'react';
import api from './api.js';

export function useGrammarFix(value, onChange) {
  const [fixing, setFixing] = useState(false);
  const [justFixed, setJustFixed] = useState(false);

  const fix = useCallback(async () => {
    if (!value?.trim() || fixing) return;
    setFixing(true);
    try {
      const { data } = await api.post('/reception/fix-grammar', { text: value });
      if (data.corrected && data.corrected !== value) {
        onChange(data.corrected);
        setJustFixed(true);
        setTimeout(() => setJustFixed(false), 2500);
      }
    } catch {}
    finally { setFixing(false); }
  }, [value, onChange, fixing]);

  return { fix, fixing, justFixed };
}
