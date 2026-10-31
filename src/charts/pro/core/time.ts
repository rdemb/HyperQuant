import { tr } from '../../../i18n';
import type { Candle } from '../hl/parse';
/** Interwały wykresu Pro i formatowanie czasu (oś i legenda w czasie lokalnym przeglądarki). */

export interface Interval {
  /** Identyfikator interwału w API Hyperliquid. */
  id: string;
  ms: number;
  label: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Klucz interwału 1M (nominalnie 30 dni): świece to miesiące kalendarza UTC, granice liczą `barStart` i `barEnd`. */
export const MONTH = 30 * DAY;
// Poniedziałek 5.01.1970 00:00 UTC: tydzień od poniedziałku, jak w TradingView i na giełdach
const MONDAY = 4 * DAY;

export const INTERVALS: readonly Interval[] = [
  { id: '1m', ms: MIN, label: '1m' },
  { id: '3m', ms: 3 * MIN, label: '3m' },
  { id: '5m', ms: 5 * MIN, label: '5m' },
  { id: '15m', ms: 15 * MIN, label: '15m' },
  { id: '30m', ms: 30 * MIN, label: '30m' },
  { id: '1h', ms: HOUR, label: '1h' },
  { id: '4h', ms: 4 * HOUR, label: '4h' },
  { id: '1d', ms: DAY, label: '1D' },
  { id: '1w', ms: WEEK, label: '1W' },
  { id: '1M', ms: MONTH, label: '1M' },
];

export const DEFAULT_INTERVAL = '5m';

export function intervalById(id: string): Interval {
  return INTERVALS.find((i) => i.id === id) ?? INTERVALS[2];
}

/**
 * Początek świecy zawierającej `t` (świece HL są wyrównane do epoki UTC, także 1D do 00:00 UTC). Tydzień od poniedziałku
 * 00:00 UTC, miesiąc od 1. dnia 00:00 UTC.
 */
export function barStart(t: number, ms: number): number {
  if (ms === WEEK) return Math.floor((t - MONDAY) / WEEK) * WEEK + MONDAY;
  if (ms === MONTH) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return Math.floor(t / ms) * ms;
}

/** Koniec (wyłączny) świecy zaczętej w `t`: na 1M początek następnego miesiąca. */
export function barEnd(t: number, ms: number): number {
  if (ms !== MONTH) return t + ms;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Interwał dłuższy niż doba: świece składamy ze świec 1D (własne granice tygodnia i miesiąca, bez taśmy w świecy). */
export const fromDaily = (ms: number): boolean => ms > DAY;

/** Świece interwału `ms` złożone ze świec krótszych (posortowanych): OHLC, suma wolumenu i transakcji. */
export function aggregateCandles(list: readonly Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const x of list) {
    const t = barStart(x.t, ms);
    if (!cur || cur.t !== t) {
      cur = { ...x, t };
      out.push(cur);
      continue;
    }
    cur.h = Math.max(cur.h, x.h);
    cur.l = Math.min(cur.l, x.l);
    cur.c = x.c;
    cur.v += x.v;
    cur.n += x.n;
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** HH:MM w czasie lokalnym. */
export function fmtHm(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HH:MM:SS w czasie lokalnym. */
export function fmtHms(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** DD.MM w czasie lokalnym. */
export function fmtDm(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Pełna etykieta czasu świecy do legendy i krzyża (np. „pt 24.10 14:35”). Świece od doby zaczynają się o 00:00 UTC, więc
 * ich data jest w UTC (na zachód od Greenwich czas lokalny dałby dzień wcześniej).
 */
export function fmtBarTime(t: number, ms: number): string {
  const d = new Date(t);
  const WD = tr(['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  if (ms === MONTH) return `${tr(MONTHS_PL, MONTHS_EN)[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (ms >= DAY) return `${WD[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return `${WD[d.getDay()]} ${fmtDm(t)} ${fmtHm(t)}`;
}

/** Chwila w przeszłości: HH:MM dziś, „DD.MM HH:MM” dla wcześniejszych dni (czas lokalny). */
export function fmtSince(t: number, now: number): string {
  return new Date(t).toDateString() === new Date(now).toDateString() ? fmtHm(t) : `${fmtDm(t)} ${fmtHm(t)}`;
}
