import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LedgerBar,
  LedgerEntry,
  appendEntry,
  clearLedger,
  exportLedgerJson,
  ledgerMetrics,
  loadLedger,
  resolvePending,
  saveLedger,
} from '../../utils/forecastLedger';

/**
 * Dziennik trafności w stanie widoku: odczyt z localStorage, automatyczne rozstrzyganie na świecach
 * (tylko realnych — nigdy na świecach zastępczych) i zapis po każdej zmianie.
 */
export function usePlanLedger(opts: { bars: LedgerBar[]; barMs: number; realBars: boolean; nowTick: number }) {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => loadLedger());
  const [persisted, setPersisted] = useState(true);
  const { bars, barMs, realBars, nowTick } = opts;

  useEffect(() => {
    if (!realBars) return;
    setEntries((prev) => {
      const next = resolvePending(prev, bars, Date.now(), barMs);
      return next.some((e, i) => e !== prev[i]) ? next : prev;
    });
  }, [bars, barMs, realBars, nowTick]);

  useEffect(() => {
    setPersisted(saveLedger(entries));
  }, [entries]);

  const add = useCallback((e: LedgerEntry) => setEntries((prev) => appendEntry(prev, e)), []);
  const clear = useCallback(() => {
    clearLedger();
    setEntries([]);
  }, []);
  const download = useCallback(() => {
    const blob = new Blob([exportLedgerJson(entries)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperquant-dziennik-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [entries]);

  const metrics = useMemo(() => ledgerMetrics(entries), [entries]);
  return { entries, metrics, persisted, add, clear, download };
}

export type PlanLedger = ReturnType<typeof usePlanLedger>;
