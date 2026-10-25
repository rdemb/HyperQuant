import { useEffect, useState } from 'react';
import { afterFirstSync, loadVolModel } from '../utils/marketDataFeed';
import { VolModel } from '../utils/volatility';

export interface VolModelState {
  /** loading = pierwsze pobieranie; error = brak modelu (desk używa σ Parkinsona i to oznacza) */
  status: 'loading' | 'ready' | 'error';
  model: VolModel | null;
}

/** Model przebudowywany co godzinę (nowa świeca 1h); sprawdzenie co 5 min i po powrocie do karty. */
const REFRESH_MS = 60 * 60 * 1000;
const CHECK_MS = 5 * 60 * 1000;

// Cache modułowy: jeden model na kartę, wspólny dla widoków (bez ponownego pobierania przy przełączaniu)
let cache: { model: VolModel; at: number } | null = null;
let inflight: Promise<VolModel | null> | null = null;

/**
 * Model zmienności (sezonowy log-HAR + FHS) z publicznego API Hyperliquid.
 * Błąd pobierania zostawia poprzedni model; bez żadnego modelu status = error (nigdy liczby zastępcze).
 * `enabled` = false (widok go nie używa) — bez pobierania ok. 1,3 MB świec; pierwsze pobranie po pierwszej synchronizacji desku.
 */
export function useVolModel(enabled = true): VolModelState {
  const [state, setState] = useState<VolModelState>(() =>
    cache ? { status: 'ready', model: cache.model } : { status: 'loading', model: null }
  );

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (cache && Date.now() - cache.at < REFRESH_MS) {
        const m = cache.model;
        setState((s) => (s.model === m ? s : { status: 'ready', model: m }));
        return;
      }
      if (!inflight) inflight = afterFirstSync().then(() => loadVolModel()).finally(() => (inflight = null));
      inflight.then((m) => {
        if (m) cache = { model: m, at: Date.now() };
        if (!alive) return;
        if (m) setState({ status: 'ready', model: m });
        else setState((s) => (s.model ? s : { status: 'error', model: null }));
      });
    };
    run();
    const id = window.setInterval(run, CHECK_MS);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled]);

  return state;
}
