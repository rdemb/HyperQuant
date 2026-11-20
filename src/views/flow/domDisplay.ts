import { locale } from '../../i18n';

const digits = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3, useGrouping: false });
const units = ['', 'k', 'M', 'B', 'T'];

/** Skrót do tabeli. Pełna kwota pochodzi z oryginalnej wartości poza kolumną. */
export function compactDomUsd(micros: bigint, signed = false): string {
  if (micros === 0n) return '0';
  const magnitude = micros < 0n ? -micros : micros;
  const usd = Number(magnitude) / 1_000_000;
  const sign = signed ? micros < 0n ? '−' : '+' : '';
  if (magnitude < 1_000n) return sign + digits.format(Number(magnitude)) + 'µ';
  if (magnitude < 10_000n) return sign + digits.format(Number(magnitude) / 1_000) + 'm';
  const scale = Math.floor(Math.log10(usd / .9995) / 3);
  const step = Math.max(0, Math.min(units.length - 1, scale));
  return sign + digits.format(usd / 1000 ** step) + units[step];
}
