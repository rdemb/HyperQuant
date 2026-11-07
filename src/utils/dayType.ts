/**
 * Typ dnia wg Daltona (MODEL): klasyfikacja sesji po jej IB (pierwszej godzinie) i końcowym zakresie, oraz migracja
 * wartości względem poprzedniej sesji. Value area (70%) liczy istniejąca `profile` z `./auction` na świecach 1m sesji;
 * ta część dostaje tylko gotowe VAH i VAL.
 */

export type DayType = 'normal' | 'normal-variation' | 'trend' | 'neutral' | 'unknown';

export type VaMigration = 'higher' | 'lower' | 'overlap-higher' | 'overlap-lower' | 'inside' | 'outside';

/** Zakres dnia do ≤ 1,15 IB to „normal”; trend wymaga zakresu ≥ 2 IB; zamknięcie „przy skraju” to skrajne 20% zakresu. */
const NORMAL_MAX = 1.15;
const TREND_MIN = 2;
const EDGE = 0.2;
/** Tolerancja zmiennoprzecinkowa (1,15 · IB nie jest dokładne w binarnym zapisie). */
const EPS = 1e-9;

export function classifyDay(x: { ibHi: number; ibLo: number; hi: number; lo: number; close: number }): DayType {
  const ibr = x.ibHi - x.ibLo;
  const r = x.hi - x.lo;
  if (![ibr, r, x.close].every(Number.isFinite) || ibr <= 0) return 'unknown';
  const up = x.hi > x.ibHi;
  const down = x.lo < x.ibLo;
  if (up && down) return 'neutral';
  if (r <= NORMAL_MAX * ibr + EPS * ibr) return 'normal';
  if (r >= TREND_MIN * ibr - EPS * ibr) {
    // Zamknięcie w skrajnych 20% zakresu po stronie wybicia
    if (up && x.close >= x.hi - EDGE * r) return 'trend';
    if (down && x.close <= x.lo + EDGE * r) return 'trend';
  }
  return 'normal-variation';
}

/** Gdzie leży value area dzisiejszej sesji względem poprzedniej (krawędzie stykające się liczą się jako nakładanie). */
export function vaMigration(today: { vah: number; val: number }, prev: { vah: number; val: number }): VaMigration {
  if (today.val > prev.vah) return 'higher';
  if (today.vah < prev.val) return 'lower';
  if (today.val >= prev.val && today.vah <= prev.vah) return 'inside';
  if (today.val <= prev.val && today.vah >= prev.vah) return 'outside';
  return today.vah > prev.vah ? 'overlap-higher' : 'overlap-lower';
}
