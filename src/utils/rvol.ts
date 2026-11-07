import type { VBar } from './auction';

/** RVOL wg godzin (MODEL): wolumen świecy wobec mediany wolumenu świec z tego samego miejsca doby z poprzednich dni. */

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Najmniej dni w próbie; mniej — brak wartości (nie zgadujemy). */
export const RVOL_MIN_DAYS = 10;
/** Najkrótszy upływ bieżącej godziny, od którego liczymy proporcję (wcześniej szum z kilku transakcji). */
const MIN_ELAPSED_MS = 5 * 60_000;

/** Mediana niepustej próby (wspólna z typową szerokością godziny w Czwórce). */
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Wolumeny świec z tego samego miejsca doby (UTC) w oknie `days` dni przed `t`; `slot` — świece tego miejsca rosnąco po czasie. */
const sample = (slot: readonly VBar[], upto: number, t: number, days: number): number[] => {
  const out: number[] = [];
  for (let j = upto - 1; j >= 0 && slot[j].time >= t - days * DAY; j--) if (Number.isFinite(slot[j].volume)) out.push(slot[j].volume);
  return out;
};

const bySlot = (bars: readonly VBar[]): Map<number, VBar[]> => {
  const m = new Map<number, VBar[]>();
  for (const b of bars) {
    const k = ((b.time % DAY) + DAY) % DAY;
    const a = m.get(k);
    if (a) a.push(b);
    else m.set(k, [b]);
  }
  return m;
};

/**
 * RVOL każdej świecy: wolumen / mediana wolumenu świec z tej samej godziny i minuty UTC z poprzednich `days` dni.
 * `intervalMs` jest zarezerwowany (miejsce doby wynika z czasu świecy, więc interwał nie zmienia wzoru).
 * `null`, gdy próba ma mniej niż 10 dni albo mediana wynosi 0. Świece muszą być rosnąco po czasie.
 */
export function rvolSeries(bars: VBar[], intervalMs: number, days = 20): (number | null)[] {
  const slots = bySlot(bars);
  const pos = new Map<number, number>();
  return bars.map((b) => {
    const k = ((b.time % DAY) + DAY) % DAY;
    const slot = slots.get(k)!;
    const i = pos.get(k) ?? 0;
    pos.set(k, i + 1);
    const xs = sample(slot, i, b.time, days);
    if (xs.length < RVOL_MIN_DAYS || !Number.isFinite(b.volume)) return null;
    const med = median(xs);
    return med > 0 ? b.volume / med : null;
  });
}

/**
 * RVOL bieżącej, niepełnej godziny: dotychczasowy wolumen wobec mediany tej godziny z poprzednich `days` dni
 * pomniejszonej proporcjonalnie do upływu godziny. `n` — liczba dni w próbie. Przed upływem 5 minut godziny albo bez
 * świecy godziny — `value: null`.
 */
export function rvolHour(hourly: VBar[], now: number, days = 20): { value: number | null; n: number } {
  const start = Math.floor(now / HOUR) * HOUR;
  const k = ((start % DAY) + DAY) % DAY;
  const slot = hourly.filter((b) => ((b.time % DAY) + DAY) % DAY === k && b.time < start);
  const xs = sample(slot, slot.length, start, days);
  const elapsed = now - start;
  const cur = hourly.find((b) => b.time === start);
  if (xs.length < RVOL_MIN_DAYS || !cur || elapsed < MIN_ELAPSED_MS || !Number.isFinite(cur.volume)) return { value: null, n: xs.length };
  const med = median(xs);
  return { value: med > 0 ? cur.volume / (med * (elapsed / HOUR)) : null, n: xs.length };
}
