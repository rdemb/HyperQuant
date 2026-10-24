import { DASH } from '../../ui';
import { lang } from '../../i18n';

/** Etykieta horyzontu w świecach z polską odmianą: +1 świeca, +3 świece, +6 świec. */
export function candlesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = lang === 'en' ? (n === 1 ? 'candle' : 'candles') : n === 1 ? 'świeca' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'świece' : 'świec';
  return `+${n} ${word}`;
}

/** Czas odpowiadający `stepBars` świecom przy interwale `timeframeSec` (min / h / d). */
export function horizonDuration(stepBars: number, timeframeSec: number): string {
  if (!(timeframeSec > 0) || !(stepBars > 0)) return DASH;
  const totalSec = stepBars * timeframeSec;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)} min`;
  if (totalSec < 48 * 3600) return `${Number((totalSec / 3600).toFixed(1))} h`;
  return `${Number((totalSec / 86400).toFixed(1))} d`;
}
