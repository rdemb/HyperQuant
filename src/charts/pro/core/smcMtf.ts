import { DAY } from './time';
import { DEFAULT_SMC_PARAMS, type SBar, type SmcParams, type SmcResult, smcStructure } from './smcStructure';

/**
 * Struktura i płynność (SMC+HL) z wyższego interwału na niższym wykresie. Ten sam model
 * (`smcStructure`) liczony tylko na **zamkniętych** świecach wyższego interwału, więc `known` każdego elementu to
 * zamknięcie świecy wyższego interwału, która go potwierdza; bieżąca, niezamknięta świeca nie tworzy niczego.
 *
 * - **Wybór interwału:** automatycznie 4H dla wykresów do 30m (projekt: do 15m; 30m też 4H, bo 1D to 48 świec 30m
 *   na jedną), 1D dla 1h–4h, brak dla 1D i wyżej; ręcznie z listy w parametrach albo wyłączony.
 * - **Parametr „Wyższy interwał”:** liczba — 0 automatycznie, −1 wyłączony, inaczej interwał w minutach.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const WEEK = 7 * DAY;

/** Wartość parametru: wybór automatyczny. */
export const SMC_HTF_AUTO = 0;
/** Wartość parametru: bez wyższego interwału. */
export const SMC_HTF_OFF = -1;
/** Interwały do wyboru ręcznego (minuty) i identyfikatory serii świec w magazynie. */
const HTF_IDS: Readonly<Record<number, string>> = { 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w' };
/** Lista wartości parametru „Wyższy interwał”: auto, wyłączony, potem interwały rosnąco. */
export const SMC_HTF_OPTIONS: readonly number[] = [SMC_HTF_AUTO, SMC_HTF_OFF, ...Object.keys(HTF_IDS).map(Number)];

/** Podpis interwału w etykietach („4H FVG”): minuty małą literą, godziny, doby i tygodnie wielką. */
export function htfLabel(ms: number): string {
  if (ms === 30 * DAY) return '1M';
  if (ms % WEEK === 0) return `${ms / WEEK}W`;
  if (ms % DAY === 0) return `${ms / DAY}D`;
  if (ms % HOUR === 0) return `${ms / HOUR}H`;
  return `${Math.round(ms / MIN)}m`;
}

/** Wyższy interwał wyboru automatycznego dla wykresu `chartMs` (null — brak, wykres 1D i wyżej). */
export function autoHtfMs(chartMs: number): number | null {
  if (chartMs <= 30 * MIN) return 4 * HOUR;
  if (chartMs <= 4 * HOUR) return DAY;
  return null;
}

export type HtfPick =
  /** Interwał w użyciu: identyfikator serii świec, długość i podpis; `auto` — z wyboru automatycznego. */
  | { kind: 'on'; id: string; ms: number; label: string; auto: boolean }
  /** Wyłączony w parametrach. */
  | { kind: 'off' }
  /** Wybór automatyczny bez wyższego interwału (wykres 1D i wyżej). */
  | { kind: 'none' }
  /** Wybrany ręcznie interwał nie jest wyższy od interwału wykresu. */
  | { kind: 'notHigher'; label: string };

/** Wyższy interwał dla wykresu `chartMs` przy wartości parametru `param` (nieznana wartość — jak automatyczny). */
export function pickHtf(chartMs: number, param: number): HtfPick {
  if (param === SMC_HTF_OFF) return { kind: 'off' };
  const manual = HTF_IDS[param];
  if (manual) {
    const ms = param * MIN;
    return ms > chartMs ? { kind: 'on', id: manual, ms, label: htfLabel(ms), auto: false } : { kind: 'notHigher', label: htfLabel(ms) };
  }
  const ms = autoHtfMs(chartMs);
  if (ms === null) return { kind: 'none' };
  return { kind: 'on', id: HTF_IDS[ms / MIN], ms, label: htfLabel(ms), auto: true };
}

/** Świece wyższego interwału zamknięte do `now` (koniec ≤ `now`), rosnąco; od pierwszej niezamkniętej — nic. */
export function closedHtfBars(candles: readonly SBar[], ms: number, now: number): SBar[] {
  const out: SBar[] = [];
  for (const c of candles) {
    if (c.t + ms > now) break;
    out.push({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c });
  }
  return out;
}

/** Model SMC wyższego interwału: jego zamknięte świece, wynik i podpis. */
export interface SmcMtf {
  ms: number;
  label: string;
  bars: SBar[];
  result: SmcResult;
  /** Minimum świec do stanu struktury (3 × okno skali swingowej). */
  need: number;
}

/** Elementy wyższego interwału `ms` ze świec `candles` (mogą zawierać świecę w toku — nie wchodzi) w chwili `now`. */
export function smcMtf(candles: readonly SBar[], ms: number, now: number, params: SmcParams = DEFAULT_SMC_PARAMS): SmcMtf {
  const bars = closedHtfBars(candles, ms, now);
  return { ms, label: htfLabel(ms), bars, result: smcStructure(bars, ms, params), need: 3 * params.swingLen };
}
