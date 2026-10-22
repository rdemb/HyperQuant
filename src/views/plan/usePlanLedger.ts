import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LedgerEntry,
  appendEntry,
  clearLedger,
  exportLedgerJson,
  ledgerFetchStart,
  ledgerMetrics,
  loadLedger,
  resolvePending,
  saveLedger,
} from '../../utils/forecastLedger';
import { loadMinuteCandles } from '../../utils/marketDataFeed';

/** Rozstrzyganie co minutę, dopóki są oczekujące plany (waga API ≈ 20 + liczba świec/60). */
const RESOLVE_EVERY_MS = 60_000;
const MINUTE_MS = 60_000;

/**
 * Dziennik trafności w stanie widoku: odczyt z localStorage, automatyczne rozstrzyganie na realnych świecach 1m
 * z API Hyperliquid (niezależnie od interwału wykresu — minuta w toku przy zapisie jest jedynym pomijanym oknem,
 * więc rozstrzyganie odpowiada temu, co prognozuje Monte Carlo) i zapis po każdej zmianie.
 */
export function usePlanLedger() {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => loadLedger());
  const [persisted, setPersisted] = useState(true);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const hasPending = entries.some((e) => e.status === 'pending');

  useEffect(() => {
    if (!hasPending) return;
    let alive = true;
    let busy = false;
    const run = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      const start = ledgerFetchStart(entriesRef.current);
      if (start === null) return;
      busy = true;
      try {
        const bars = await loadMinuteCandles(start);
        if (!alive || bars.length === 0) return;
        setEntries((prev) => {
          const next = resolvePending(prev, bars, Date.now(), MINUTE_MS);
          return next.some((e, i) => e !== prev[i]) ? next : prev;
        });
      } finally {
        busy = false;
      }
    };
    run();
    const id = window.setInterval(run, RESOLVE_EVERY_MS);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, [hasPending]);

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
