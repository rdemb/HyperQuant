import { useEffect, useState } from 'react';
import { parseCandle } from '../../charts/pro/hl/parse';
import { fetchCandles } from '../../charts/pro/hl/rest';
import { HlStream } from '../../charts/pro/hl/stream';
import { MACRO_EVENTS } from '../../data/macroCalendar';
import { type Bar, type Forecast, type SchrodiInput, type SchrodiModel, type Snap, type Stance, type TouchModel, holdStance, liveForecast, modelEvents, snapOf } from '../../utils/schrodi';
import type { HourModel } from '../../utils/schrodiHour';

/**
 * Prognoza Schrödiego na żywo: model z `public/schrodi/model-v1.json` (wczytywany raz, przy pierwszym użyciu), świece BTC
 * z Hyperliquid: minuty z REST (ok. 3,5 doby) i kanału `candle` 1m na WebSocket, starsze 5m, 1h i 1d z REST co 30 min.
 * Przeliczenie po każdej aktualizacji minuty, najwyżej raz na sekundę (karta w tle czeka do powrotu), na świecach 5m
 * kończących się teraz. Historia zdania z ostatniej godziny: koniec każdej minuty (na starcie dopełniona z tych samych minut).
 */

const MIN = 60_000;
const HOUR = 3_600_000;
/** Hyperliquid oddaje najwyżej 5000 ostatnich świec */
const M1_KEEP = 4990;
const THROTTLE_MS = 1000;
const TICK_MS = 5000;
/** Bez nowych minut z WebSocket przez tyle ms: minuty z REST */
const POLL_AFTER_MS = 30_000;
const REFRESH_MS = 30 * MIN;
export const HIST_MIN = 60;

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

let modelPromise: Promise<SchrodiModel | null> | null = null;
export function loadModel(): Promise<SchrodiModel | null> {
  modelPromise ??= fetch(`${BASE}/schrodi/model-v1.json`)
    .then((r) => (r.ok ? (r.json() as Promise<SchrodiModel>) : null))
    .catch(() => null);
  return modelPromise;
}

let touchPromise: Promise<TouchModel | null> | null = null;
/** Model dotknięć (ok. 200 kB po kompresji) wczytywany dopiero po otwarciu dymka */
export function loadTouchModel(): Promise<TouchModel | null> {
  touchPromise ??= fetch(`${BASE}/schrodi/touch-v1.json`)
    .then((r) => (r.ok ? (r.json() as Promise<TouchModel>) : null))
    .catch(() => null);
  return touchPromise;
}

export function useTouchModel(): TouchModel | null {
  const [m, setM] = useState<TouchModel | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTouchModel().then((x) => alive && setM(x));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

let hourPromise: Promise<HourModel | null> | null = null;
/** Model godziny na żywo (ok. 340 kB po kompresji) wczytywany dopiero po otwarciu dymka */
export function useHourModel(): HourModel | null {
  const [m, setM] = useState<HourModel | null>(null);
  useEffect(() => {
    let alive = true;
    hourPromise ??= fetch(`${BASE}/schrodi/hour-v1.json`)
      .then((r) => (r.ok ? (r.json() as Promise<HourModel>) : null))
      .catch(() => null);
    void hourPromise.then((x) => alive && setM(x));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

const EVENTS = modelEvents(MACRO_EVENTS);

const bars = (xs: Bar[]) => xs.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));

async function loadSlow(now: number): Promise<Pick<SchrodiInput, 'm5' | 'h1' | 'd1'>> {
  const [m5, h1, d1] = await Promise.all([
    fetchCandles('BTC', '5m', now - 2110 * 5 * MIN),
    fetchCandles('BTC', '1h', now - 725 * 60 * MIN),
    fetchCandles('BTC', '1d', now - 35 * 1440 * MIN),
  ]);
  return { m5: bars(m5), h1: bars(h1), d1: bars(d1) };
}

/** Dopisanie minuty w porządku czasu (ta sama minuta: nowsza wersja wygrywa), najwyżej M1_KEEP ostatnich */
export function mergeMinute(m1: Bar[], b: Bar): void {
  let i = m1.length;
  while (i > 0 && m1[i - 1].t > b.t) i--;
  if (i > 0 && m1[i - 1].t === b.t) m1[i - 1] = b;
  else m1.splice(i, 0, b);
  if (m1.length > M1_KEEP) m1.splice(0, m1.length - M1_KEEP);
}

export type SchrodiState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; f: Forecast; model: SchrodiModel; at: number; hist: Snap[]; hour: HourLive | null };

/** Bieżąca pełna godzina: prognoza kota z jej początku (jak w dzienniku o pełnej godzinie) i jej minuty do teraz */
export interface HourLive {
  start: { hs: number; c0: number; thr: number; pBig: number; pUp: number };
  m1: Bar[];
}

export function useSchrodi(enabled = true): SchrodiState {
  const [state, setState] = useState<SchrodiState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let model: SchrodiModel | null = null;
    let inp: SchrodiInput | null = null;
    /** Chwila ostatnich świeżych danych (zegar klienta) */
    let rx = 0;
    let lastRun = 0;
    let lastSlow = 0;
    let lastPoll = 0;
    let dirty = false;
    let hist: Snap[] = [];
    let stance: Stance | null = null;
    let h0: HourLive['start'] | null = null;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stream = new HlStream();
    const sub = { type: 'candle', coin: 'BTC', interval: '1m' } as const;

    const run = () => {
      if (!alive || !model || !inp || document.hidden) return;
      dirty = false;
      lastRun = Date.now();
      const raw = liveForecast(model, inp);
      if (!raw) {
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
        return;
      }
      const f = { ...raw, stance: holdStance(stance, raw.pUp) };
      stance = f.stance;
      const snap = snapOf(f);
      hist = [...hist.filter((h) => h.s !== snap.s && h.s > snap.s - (HIST_MIN + 1) * MIN), snap];
      const hs = Math.floor(snap.s / HOUR) * HOUR;
      if (h0?.hs !== hs) {
        const g = liveForecast(model, inp, hs);
        h0 = g && Number.isFinite(g.med1h) ? { hs, c0: g.price, thr: g.med1h, pBig: g.pBig, pUp: g.pUp } : null;
      }
      const hour = h0 ? { start: h0, m1: inp.m1.filter((b) => b.t >= hs) } : null;
      setState({ status: 'ready', f, model, at: rx, hist, hour });
    };
    const kick = () => {
      dirty = true;
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        run();
      }, Math.max(0, lastRun + THROTTLE_MS - Date.now()));
    };
    const pullMinutes = async () => {
      if (!inp) return;
      lastPoll = Date.now();
      const from = inp.m1.length ? inp.m1[inp.m1.length - 1].t - MIN : Date.now() - M1_KEEP * MIN;
      const xs = bars(await fetchCandles('BTC', '1m', from));
      if (!alive || !inp || !xs.length) return;
      for (const b of xs) mergeMinute(inp.m1, b);
      rx = Date.now();
      kick();
    };
    /** Historia ostatniej godziny z tych samych minut, po kawałku (ok. 3 ms na prognozę) */
    const backfill = (s: number, i = HIST_MIN) => {
      if (!alive || !model || !inp || i < 1) return;
      const out: Snap[] = [];
      for (let j = i; j > Math.max(0, i - 10); j--) {
        const f = liveForecast(model, inp, s - j * MIN);
        if (f) out.push(snapOf(f));
      }
      const have = new Set(hist.map((h) => h.s));
      hist = [...out.filter((h) => !have.has(h.s)), ...hist].sort((a, b) => a.s - b.s);
      if (i - 10 >= 1) setTimeout(() => backfill(s, i - 10), 0);
      else kick();
    };

    stream.listen({
      onMessage: (channel, data) => {
        if (channel !== 'candle' || !inp) return;
        const c = parseCandle(data);
        if (!c || (data as { s?: unknown }).s !== 'BTC') return;
        mergeMinute(inp.m1, { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
        rx = Date.now();
        kick();
      },
      // Po ponownym połączeniu: luka w minutach z REST
      onSubscribed: () => void pullMinutes(),
    });
    const onVisible = () => !document.hidden && dirty && kick();
    document.addEventListener('visibilitychange', onVisible);
    const tick = setInterval(() => {
      if (!inp) return;
      const now = Date.now();
      if (now - lastSlow > REFRESH_MS) {
        lastSlow = now;
        void loadSlow(now).then((x) => {
          if (alive && inp && x.m5.length && x.h1.length && x.d1.length) Object.assign(inp, x);
        });
      }
      if (now - rx > POLL_AFTER_MS && now - lastPoll > POLL_AFTER_MS) void pullMinutes();
      if (dirty || now - lastRun > 15_000) kick();
    }, TICK_MS);

    void (async () => {
      const now = Date.now();
      model = await loadModel();
      if (!model) {
        if (alive) setState({ status: 'error' });
        return;
      }
      const [m1, slow] = await Promise.all([fetchCandles('BTC', '1m', now - M1_KEEP * MIN), loadSlow(now)]);
      if (!alive) return;
      inp = { m1: bars(m1), ...slow, events: EVENTS };
      rx = lastSlow = lastPoll = Date.now();
      run();
      if (inp.m1.length) backfill(inp.m1[inp.m1.length - 1].t + MIN);
      stream.add(sub);
      stream.start();
    })();
    return () => {
      alive = false;
      clearTimeout(pending);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      stream.stop();
    };
  }, [enabled]);
  return state;
}
