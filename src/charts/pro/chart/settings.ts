import type { ResetMode } from '../core/sessions';
import { DEFAULT_INTERVAL, INTERVALS } from '../core/time';
import type { ChartView } from './footprintSeries';
import type { FootprintStyle } from './layout';

/** Ustawienia wykresu Pro zapamiętywane w przeglądarce (tylko wygoda użytkownika — brak danych osobowych). */
export interface ChartSettings {
  interval: string;
  view: ChartView;
  fpStyle: FootprintStyle;
  /** Wysokość wiersza footprintu (USD); 0 = automatycznie. */
  rowStep: number;
  imbalanceRatio: number;
  imbalanceMinVol: number;
  stackedMin: number;
  showVolume: boolean;
  showDelta: boolean;
  showCvd: boolean;
  cvdReset: ResetMode;
}

export const DEFAULT_SETTINGS: ChartSettings = {
  interval: DEFAULT_INTERVAL,
  view: 'footprint',
  fpStyle: 'bidask',
  rowStep: 0,
  imbalanceRatio: 3,
  imbalanceMinVol: 0.05,
  stackedMin: 3,
  showVolume: true,
  showDelta: true,
  showCvd: true,
  cvdReset: 'session',
};

const KEY = 'hq.charts.v1';

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const numIn = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Odczyt z walidacją każdego pola (stary lub uszkodzony zapis → wartości domyślne). */
export function parseSettings(raw: unknown): ChartSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    interval: oneOf(r.interval, INTERVALS.map((i) => i.id), d.interval),
    view: oneOf(r.view, ['candles', 'footprint'] as const, d.view),
    fpStyle: oneOf(r.fpStyle, ['bidask', 'delta', 'volume'] as const, d.fpStyle),
    rowStep: numIn(r.rowStep, 0, 10_000, d.rowStep),
    imbalanceRatio: numIn(r.imbalanceRatio, 1.1, 10, d.imbalanceRatio),
    imbalanceMinVol: numIn(r.imbalanceMinVol, 0, 1000, d.imbalanceMinVol),
    stackedMin: numIn(r.stackedMin, 0, 10, d.stackedMin),
    showVolume: bool(r.showVolume, d.showVolume),
    showDelta: bool(r.showDelta, d.showDelta),
    showCvd: bool(r.showCvd, d.showCvd),
    cvdReset: oneOf(r.cvdReset, ['none', 'session', 'day', 'week'] as const, d.cvdReset),
  };
}

export function loadSettings(): ChartSettings {
  try {
    const s = localStorage.getItem(KEY);
    return parseSettings(s ? JSON.parse(s) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ChartSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Prywatne okno albo zablokowana pamięć — ustawienia działają do końca sesji
  }
}
