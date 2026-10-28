import { useEffect, useState } from 'react';
import { fetchCandles } from '../../charts/pro/hl/rest';
import { MACRO_EVENTS } from '../../data/macroCalendar';
import { type Bar, type Forecast, type SchrodiModel, forecast, lastClosed5m, modelEvents } from '../../utils/schrodi';

/**
 * Prognoza Schrödiego na żywo: model z `public/schrodi/model-v1.json` (wczytywany raz, przy pierwszym użyciu), świece BTC
 * z Hyperliquid (1m, 5m, 1h, 1d — zapytania jak wykres) i przeliczenie po zamknięciu każdej świecy 5m.
 */

const MIN = 60_000;
/** Przeliczenie 20 s po zamknięciu świecy 5m (świeca jest już w API) */
const AFTER_CLOSE_MS = 20_000;

let modelPromise: Promise<SchrodiModel | null> | null = null;
export function loadModel(): Promise<SchrodiModel | null> {
  modelPromise ??= fetch(`${import.meta.env.BASE_URL.replace(/\/+$/, '')}/schrodi/model-v1.json`)
    .then((r) => (r.ok ? (r.json() as Promise<SchrodiModel>) : null))
    .catch(() => null);
  return modelPromise;
}

const EVENTS = modelEvents(MACRO_EVENTS);

async function loadInput(now: number) {
  const [m1, m5, h1, d1] = await Promise.all([
    fetchCandles('BTC', '1m', now - 4990 * MIN),
    fetchCandles('BTC', '5m', now - 2110 * 5 * MIN),
    fetchCandles('BTC', '1h', now - 725 * 60 * MIN),
    fetchCandles('BTC', '1d', now - 35 * 1440 * MIN),
  ]);
  const bars = (xs: Bar[]) => xs.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
  return { m1: bars(m1), m5: bars(m5), h1: bars(h1), d1: bars(d1), events: EVENTS };
}

export type SchrodiState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; f: Forecast; model: SchrodiModel; at: number };

export function useSchrodi(enabled = true): SchrodiState {
  const [state, setState] = useState<SchrodiState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const now = Date.now();
      const model = await loadModel();
      const inp = model ? await loadInput(now) : null;
      if (!alive) return;
      const f = model && inp ? forecast(model, inp, lastClosed5m(now)) : null;
      // Błąd sieci przy kolejnym przeliczeniu nie kasuje ostatniej dobrej prognozy
      setState((prev) => (model && f ? { status: 'ready', f, model, at: now } : prev.status === 'ready' ? prev : { status: 'error' }));
      const next = (Math.floor(Date.now() / (5 * MIN)) + 1) * 5 * MIN + AFTER_CLOSE_MS;
      timer = setTimeout(() => void run(), Math.max(5_000, next - Date.now()));
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return state;
}
