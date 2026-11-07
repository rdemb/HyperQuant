/**
 * RVOL bieżącej godziny ze świec 1h z powodem braku — dla nagłówka układu na wykresie i serwera MCP. Osobny moduł, żeby
 * lekki `rvol.ts` (wskaźnik RVOL, Czwórka) nie ciągnął do wspólnych paczek strony zamiany świec (`toVBars`).
 */
import { tr } from '../i18n';
import type { Candle } from '../charts/pro/hl/parse';
import { toVBars } from './auction';
import { RVOL_MIN_DAYS, rvolHour } from './rvol';
import type { Got } from './sessionText';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** RVOL bieżącej godziny ze świec 1h; brak — powód (krótka historia, pierwsze 5 min godziny, brak świecy). */
export function rvolOf(c1h: readonly Candle[], now: number): Got<{ value: number; n: number; hour: number }> {
  if (c1h.length === 0) return { why: tr('Czekam na świece 1h', 'Waiting for 1h candles') };
  const hour = Math.floor(now / HOUR) * HOUR;
  const r = rvolHour(toVBars(c1h), now);
  if (r.value !== null) return { value: r.value, n: r.n, hour };
  if (r.n < RVOL_MIN_DAYS) return { why: tr(`za mało historii (min. ${RVOL_MIN_DAYS} dni)`, `not enough history (min. ${RVOL_MIN_DAYS} days)`) };
  if (now - hour < 5 * MIN) return { why: tr('Liczone od 5. minuty godziny', 'Computed from the 5th minute of the hour') };
  return { why: tr('Brak świecy bieżącej godziny albo mediana wolumenu 0', 'No candle for the current hour or a zero median volume') };
}
