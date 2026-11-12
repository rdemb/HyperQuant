import type { VBar } from './auction';
import { tzOffsetMs } from '../charts/pro/core/sessions';
import { mulberry32 } from './pathEngine';

/**
 * RVOL wg godzin (MODEL): wolumen świecy wobec mediany wolumenu świec z tej samej godziny zegarowej w Nowym Jorku
 * (America/New_York, z czasem letnim) z 20 ostatnich dni tego samego typu: dni robocze i weekend (sobota i niedziela
 * według daty w tej strefie) osobno. Wolumen przesuwa się razem z czasem w USA, więc baza godziny otwarcia NY jest ta sama
 * przed zmianą czasu i po niej.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Najmniej dni w próbie; mniej — brak wartości (nie zgadujemy). */
export const RVOL_MIN_DAYS = 10;
/** Dni tego samego typu w próbie */
export const RVOL_DAYS = 20;
/** Najdalej wstecz szukamy dni tego samego typu (20 weekendów to ok. 70 dni); tyle historii 1h pobierają nagłówek i MCP */
export const RVOL_LOOKBACK_DAYS = 80;
/** Najkrótszy upływ bieżącej godziny, od którego liczymy proporcję (wcześniej szum z kilku transakcji). */
const MIN_ELAPSED_MS = 5 * 60_000;
/** Bootstrap przedziału 80% mediany: losowania i ziarno (powtarzalne między wywołaniami) */
export const BOOT_DRAWS = 1000;
export const BOOT_SEED = 20261111;

/** Mediana niepustej próby (wspólna z typową szerokością godziny w Czwórce). */
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const NY_TZ = 'America/New_York';
/** Przesunięcie strefy NY na pełną godzinę UTC (zmiana czasu wypada zawsze na pełnej godzinie). */
const offsetCache = new Map<number, number>();
function nyOffset(t: number): number {
  const h = Math.floor(t / HOUR);
  let o = offsetCache.get(h);
  if (o === undefined) {
    o = tzOffsetMs(NY_TZ, h * HOUR);
    if (offsetCache.size > 50_000) offsetCache.clear();
    offsetCache.set(h, o);
  }
  return o;
}

/** Czas ścienny w NY: minuta doby (ms od północy NY) i czy to sobota albo niedziela według daty w NY. */
export function nyClock(t: number): { ofDay: number; weekend: boolean } {
  const local = t + nyOffset(t);
  const day = Math.floor(local / DAY);
  // 1.01.1970 to czwartek: (day + 4) mod 7 — 0 niedziela, 6 sobota
  const dow = (((day + 4) % 7) + 7) % 7;
  return { ofDay: local - day * DAY, weekend: dow === 0 || dow === 6 };
}

/**
 * Próba bazy: wolumeny `days` ostatnich wcześniejszych świec z tego samego miejsca doby w NY i dnia tego samego typu,
 * z najwyżej RVOL_LOOKBACK_DAYS dni wstecz. `slot` — świece tego miejsca doby rosnąco po czasie, `upto` — indeks bieżącej.
 */
const sample = (slot: readonly VBar[], upto: number, t: number, weekend: boolean, days: number): number[] => {
  const out: number[] = [];
  for (let j = upto - 1; j >= 0 && out.length < days && slot[j].time >= t - RVOL_LOOKBACK_DAYS * DAY; j--) {
    const b = slot[j];
    if (nyClock(b.time).weekend === weekend && Number.isFinite(b.volume)) out.push(b.volume);
  }
  return out;
};

/** Miejsce doby świecy w NY; interwały od doby wzwyż — jedno miejsce (świeca dzienna nie ma pory dnia). */
const slotKey = (t: number, intervalMs: number) => (intervalMs >= DAY ? 0 : nyClock(t).ofDay);

/**
 * RVOL każdej świecy: wolumen / mediana wolumenu świec z tej samej godziny i minuty w NY z 20 ostatnich dni tego samego
 * typu. `null`, gdy próba ma mniej niż 10 dni albo mediana wynosi 0. Świece muszą być rosnąco po czasie.
 */
export function rvolSeries(bars: VBar[], intervalMs: number, days = RVOL_DAYS): (number | null)[] {
  const slots = new Map<number, VBar[]>();
  const keys = bars.map((b) => {
    const k = slotKey(b.time, intervalMs);
    const a = slots.get(k);
    if (a) a.push(b);
    else slots.set(k, [b]);
    return k;
  });
  const pos = new Map<number, number>();
  return bars.map((b, idx) => {
    const k = keys[idx];
    const slot = slots.get(k)!;
    const i = pos.get(k) ?? 0;
    pos.set(k, i + 1);
    const xs = sample(slot, i, b.time, nyClock(b.time).weekend, days);
    if (xs.length < RVOL_MIN_DAYS || !Number.isFinite(b.volume)) return null;
    const med = median(xs);
    return med > 0 ? b.volume / med : null;
  });
}

/**
 * RVOL bieżącej, niepełnej godziny: dotychczasowy wolumen wobec mediany tej godziny w NY z 20 ostatnich dni tego samego
 * typu, pomniejszonej proporcjonalnie do upływu godziny. `n` — liczba dni w próbie, `base` — ich wolumeny (od najnowszego).
 * Przed upływem 5 minut godziny albo bez świecy godziny — `value: null`.
 */
export function rvolHour(hourly: VBar[], now: number, days = RVOL_DAYS): { value: number | null; n: number; base: number[] } {
  const start = Math.floor(now / HOUR) * HOUR;
  const { ofDay, weekend } = nyClock(start);
  const slot = hourly.filter((b) => b.time < start && b.time % HOUR === 0 && nyClock(b.time).ofDay === ofDay);
  const base = sample(slot, slot.length, start, weekend, days);
  const elapsed = now - start;
  const cur = hourly.find((b) => b.time === start);
  if (base.length < RVOL_MIN_DAYS || !cur || elapsed < MIN_ELAPSED_MS || !Number.isFinite(cur.volume)) return { value: null, n: base.length, base };
  const med = median(base);
  return { value: med > 0 ? cur.volume / (med * (elapsed / HOUR)) : null, n: base.length, base };
}

/**
 * Przedział 80% mediany z bootstrapu po dniach: 1000 losowań ze zwracaniem z próby (jeden element = jeden dzień),
 * mulberry32 z ziarnem 20261111, granice to 10. i 90. percentyl median losowań (interpolacja liniowa). Próba sortowana
 * przed losowaniem, więc kolejność wejścia nie zmienia wyniku. Pusta próba → null.
 */
export function bootstrapMedian80(xs: readonly number[], draws = BOOT_DRAWS, seed = BOOT_SEED): [number, number] | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const rnd = mulberry32(seed);
  const meds = new Float64Array(draws);
  const pick = new Float64Array(n);
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < n; i++) pick[i] = s[Math.min(n - 1, Math.floor(rnd() * n))];
    pick.sort();
    meds[d] = n % 2 ? pick[n >> 1] : (pick[(n >> 1) - 1] + pick[n >> 1]) / 2;
  }
  meds.sort();
  const q = (p: number) => {
    const x = p * (draws - 1);
    const i = Math.floor(x);
    return i + 1 < draws ? meds[i] + (x - i) * (meds[i + 1] - meds[i]) : meds[i];
  };
  return [q(0.1), q(0.9)];
}
