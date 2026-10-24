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

export const INTERVALS: readonly Interval[] = [
  { id: '1m', ms: MIN, label: '1m' },
  { id: '3m', ms: 3 * MIN, label: '3m' },
  { id: '5m', ms: 5 * MIN, label: '5m' },
  { id: '15m', ms: 15 * MIN, label: '15m' },
  { id: '30m', ms: 30 * MIN, label: '30m' },
  { id: '1h', ms: HOUR, label: '1h' },
  { id: '4h', ms: 4 * HOUR, label: '4h' },
  { id: '1d', ms: DAY, label: '1D' },
];

export const DEFAULT_INTERVAL = '5m';

export function intervalById(id: string): Interval {
  return INTERVALS.find((i) => i.id === id) ?? INTERVALS[2];
}

/** Początek świecy zawierającej `t` (świece HL są wyrównane do epoki UTC, także 1D do 00:00 UTC). */
export function barStart(t: number, ms: number): number {
  return Math.floor(t / ms) * ms;
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

/** Pełna etykieta czasu świecy do legendy i krzyża (np. „pt 24.10 14:35”). */
export function fmtBarTime(t: number, ms: number): string {
  const d = new Date(t);
  const wd = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][d.getDay()];
  const date = `${wd} ${fmtDm(t)}${ms >= DAY ? `.${d.getFullYear()}` : ''}`;
  return ms >= DAY ? date : `${date} ${fmtHm(t)}`;
}

/** Chwila w przeszłości: HH:MM dziś, „DD.MM HH:MM” dla wcześniejszych dni (czas lokalny). */
export function fmtSince(t: number, now: number): string {
  return new Date(t).toDateString() === new Date(now).toDateString() ? fmtHm(t) : `${fmtDm(t)} ${fmtHm(t)}`;
}
