/**
 * VWAP doby UTC ze świec 1m i odległość ceny od VWAP w σ — jedno źródło dla nagłówka układu na wykresie, Czwórki Przed
 * sesją, Stanu rynku i serwera MCP; tu też liczba „VWAP” nagłówka Kokpitu i Czwórki (`vwapNum`). Bez modułów rysowania
 * wykresu (tylko czyste wskaźniki, granice doby i formatowanie ceny).
 */
import { tr } from '../i18n';
import { DASH, fmtSigned } from '../ui/format';
import { fmtPx } from '../charts/pro/core/footprintBar';
import { sdUsable, vwapSeries } from '../charts/pro/core/indicators';
import { utcDayStart } from '../charts/pro/core/sessions';
import type { Candle } from '../charts/pro/hl/parse';
import { type Got, amt, isAbsent, missingWhy } from './sessionText';

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** VWAP doby UTC z 1m (rosnąco): świece muszą obejmować 00:00 UTC, inaczej VWAP byłby z części doby. */
export function dayVwapOf(c1m: readonly Candle[], now: number): Got<{ vwap: number; sd: number }> {
  if (c1m.length === 0) return { why: tr('Czekam na świece 1m', 'Waiting for 1m candles') };
  const day = utcDayStart(now);
  if (c1m[0].t > day) return { why: tr('Świece 1m nie obejmują początku doby (00:00 UTC)', 'The 1m candles do not cover the start of the day (00:00 UTC)') };
  const bars = c1m.filter((c) => c.t >= day && c.t <= now).map((c) => ({ t: c.t, candle: c }));
  const pts = vwapSeries(bars, 'day');
  const last = pts[pts.length - 1];
  return last ? { vwap: last.vwap, sd: last.sd } : { why: tr('Brak wolumenu od 00:00 UTC', 'No volume since 00:00 UTC') };
}

/**
 * Odległość ceny od VWAP w σ, zaokrąglona do 0,1 (tę liczbę widać w opisie i z nią porównujemy progi). Brak liczby albo
 * σ z szumu zaokrągleń (okres z jedną świecą) — null.
 */
export function vwapSigma(close: number, vwap: number, sd: number): number | null {
  if (![close, vwap, sd].every(Number.isFinite) || !sdUsable({ vwap, sd, start: false })) return null;
  return round((close - vwap) / sd, 1);
}

/** Wejścia liczby VWAP (te same pola co w nagłówku układu i Czwórce); pole `undefined` — jeszcze się wczytuje. */
export interface VwapInputs {
  coin: string;
  now: number;
  /** Ostatnia cena rynku. */
  price?: Got<number>;
  /** VWAP doby UTC ze świec 1m (jak linia VWAP na wykresie). */
  dayVwap?: Got<{ vwap: number; sd: number }>;
}

/** Liczba „VWAP”: odległość w σ albo „—”, plakietka LIVE i podpowiedź (skąd liczba albo powód braku). */
export interface VwapNumber {
  label: string;
  value: string;
  badge: 'LIVE';
  hint: string;
}

/** Odległość ceny od VWAP doby UTC w σ (Kokpit; ta sama liczba w Czwórce Przed sesją i w serwerze MCP). */
export function vwapNum(x: VwapInputs): VwapNumber {
  const label = 'VWAP';
  const v = x.dayVwap === undefined || isAbsent(x.dayVwap) ? null : x.dayVwap;
  const p = x.price === undefined || isAbsent(x.price) ? null : x.price;
  if (!v || p === null) return { label, value: DASH, badge: 'LIVE', hint: missingWhy(x.dayVwap, x.price) };
  const z = vwapSigma(p, v.vwap, v.sd);
  if (z === null) return { label, value: DASH, badge: 'LIVE', hint: tr('Odchylenie od VWAP jeszcze bez znaczenia: za mało świec od 00:00 UTC', 'The VWAP deviation is not meaningful yet: too few candles since 00:00 UTC') };
  const sz = fmtSigned(z, 1, 'σ');
  return {
    label,
    value: sz,
    badge: 'LIVE',
    hint: tr(
      `Cena ${fmtPx(p)} wobec VWAP doby UTC ${fmtPx(v.vwap)} (σ ${amt(v.sd)}): ${sz}. VWAP ze świec 1m od 00:00 UTC, jak linia VWAP na wykresie.`,
      `Price ${fmtPx(p)} against the UTC-day VWAP ${fmtPx(v.vwap)} (σ ${amt(v.sd)}): ${sz}. VWAP from 1m candles since 00:00 UTC, like the VWAP line on the chart.`
    ),
  };
}
