/**
 * VWAP doby UTC ze świec 1m i odległość ceny od VWAP w σ — jedno źródło dla nagłówka układu na wykresie, Czwórki Przed
 * sesją, Stanu rynku i serwera MCP. Bez modułów rysowania wykresu (tylko czyste wskaźniki i granice doby).
 */
import { tr } from '../i18n';
import { sdUsable, vwapSeries } from '../charts/pro/core/indicators';
import { utcDayStart } from '../charts/pro/core/sessions';
import type { Candle } from '../charts/pro/hl/parse';
import type { Got } from './sessionText';

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
