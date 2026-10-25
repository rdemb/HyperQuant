import type { Candle } from '../charts/pro/hl/parse';
import type { IndicatorBar } from '../charts/pro/core/indicators';

/**
 * Wycinek prawdziwego rynku do ćwiczenia (public/lessons/<id>.json, z scripts/lessons/build.mjs): świece od północy
 * UTC do końca okna, poziomy dnia poprzedniego, a gdzie desk nagrywał taśmę — delta, open interest, likwidacje
 * i footprint. Wskaźniki liczymy na stronie tymi samymi funkcjami co Wykresy.
 */

export const LESSONS_VERSION = 2;

/** Świeca: [czas, o, h, l, c, wolumen, kupno agresorów | null, sprzedaż agresorów | null] (wolumen w BTC). */
export type SliceCandle = [number, number, number, number, number, number, number | null, number | null];

export interface SliceFootprintBar {
  t: number;
  ohlc: [number, number, number, number];
  /** Zmiana open interest w świecy (BTC); null bez kontekstu. */
  oi: number | null;
  /** Komórki od najwyższej ceny: [cena dolna przedziału, sprzedaż agresorów, kupno agresorów]. */
  cells: [number, number, number][];
}

export interface LessonSlice {
  v: number;
  id: string;
  coin: string;
  /** Interwał świec w minutach. */
  tf: number;
  /** Okno widoku [from, to) (ms). */
  from: number;
  to: number;
  /** Północ UTC dnia początku okna: kotwica VWAP i profilu dnia. */
  dayStart: number;
  candles: SliceCandle[];
  /** Świece 1m od północy UTC do końca okna: [czas, o, h, l, c, wolumen] — VWAP jak w Wykresach. */
  m1: [number, number, number, number, number, number][];
  levels: { t: number; open: number | null; pdh: number; pdl: number }[];
  /** Odcinki nagranej taśmy [od, do). */
  tape: [number, number][];
  oi?: [number, number][];
  /** Likwidacje w świecy: [czas, longi mln USD, shorty mln USD]. */
  liq?: [number, number, number][];
  fp?: { tf: number; step: number; bars: SliceFootprintBar[] } | null;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function isLessonSlice(x: unknown): x is LessonSlice {
  const s = x as Partial<LessonSlice> | null;
  return (
    !!s &&
    s.v === LESSONS_VERSION &&
    typeof s.id === 'string' &&
    fin(s.tf) &&
    fin(s.from) &&
    fin(s.to) &&
    fin(s.dayStart) &&
    Array.isArray(s.candles) &&
    s.candles.length > 1 &&
    s.candles.every((c) => Array.isArray(c) && c.length === 8 && c.slice(0, 6).every(fin)) &&
    Array.isArray(s.m1) &&
    s.m1.every((c) => Array.isArray(c) && c.length === 6 && c.every(fin)) &&
    Array.isArray(s.levels) &&
    Array.isArray(s.tape)
  );
}

const cache = new Map<string, Promise<LessonSlice>>();

/** Wycinek z katalogu strony (pamięć podręczna na czas życia strony; błąd nie zostaje w pamięci). */
export function loadSlice(id: string): Promise<LessonSlice> {
  let p = cache.get(id);
  if (!p) {
    // Wersja w adresie: po zmianie formatu cache HTTP nie poda starego pliku
    p = fetch(`./lessons/${id}.json?v=${LESSONS_VERSION}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((x) => {
        if (!isLessonSlice(x)) throw new Error('zły format wycinka');
        return x;
      });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** Świeca wycinka sklejona po `k` (wąski ekran); delta tylko, gdy każda część ją ma. */
export function mergeCandles(cs: readonly SliceCandle[], k: number, tfMs: number): SliceCandle[] {
  if (k <= 1) return cs.slice();
  const out: SliceCandle[] = [];
  for (const c of cs) {
    const t = Math.floor(c[0] / (k * tfMs)) * k * tfMs;
    const last = out[out.length - 1];
    if (!last || last[0] !== t) out.push([t, c[1], c[2], c[3], c[4], c[5], c[6], c[7]]);
    else {
      last[2] = Math.max(last[2], c[2]);
      last[3] = Math.min(last[3], c[3]);
      last[4] = c[4];
      last[5] += c[5];
      last[6] = last[6] === null || c[6] === null ? null : last[6] + c[6];
      last[7] = last[7] === null || c[7] === null ? null : last[7] + c[7];
    }
  }
  return out;
}

/** Świece 1m wycinka w postaci świec Wykresów. */
export function minuteCandles(m1: LessonSlice['m1']): Candle[] {
  return m1.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v, n: 0 }));
}

/** Świece wycinka w postaci, której oczekują funkcje wskaźników Wykresów. */
export function toIndicatorBars(cs: readonly SliceCandle[]): IndicatorBar[] {
  return cs.map((c) => {
    const candle: Candle = { t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5], n: 0 };
    return { t: c[0], candle };
  });
}
