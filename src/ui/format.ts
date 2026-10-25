import { lang, tr } from '../i18n';
/** Formatowanie liczb dla UI — brak danych zawsze jako „—”. */
export const DASH = '—';

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Liczba zapisana po angielsku (80,768.5) w zapisie języka strony: po polsku twarda spacja tysięcy
 * i przecinek dziesiętny (80 768,5), żeby przecinek miał jedno znaczenie. Tylko raz na liczbę —
 * drugi raz zamieniłby przecinek dziesiętny na spację.
 */
export const numLang = (s: string): string => (lang === 'en' ? s : s.replace(/,/g, '\u00a0').replace(/\./g, ','));

/** Stała liczba miejsc po przecinku w zapisie języka strony (separator tysięcy, po polsku przecinek dziesiętny), ujemna ze znakiem „−”. */
export const fmtFixed = (v: number, digits: number): string =>
  numLang(v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })).replace(/^-/, '−');

/** Liczba bez zaokrąglania (już zaokrąglona w modelu) w zapisie języka strony, ujemna ze znakiem „−”. */
export const fmtNum = (v: number): string => numLang(String(v)).replace(/^-/, '−');

export function fmtPrice(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? fmtFixed(v, digits) : DASH;
}

/** Zwięzły zapis kwot: 1 284 / 12,9K / 4,2M / 3,1B (po angielsku 12.9K). */
export function fmtCompact(v: number | null | undefined, prefix = ''): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${prefix}${fmtFixed(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}${prefix}${fmtFixed(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${sign}${prefix}${fmtFixed(a / 1e3, 1)}K`;
  return `${sign}${prefix}${a.toFixed(0)}`;
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (!isNum(v)) return DASH;
  const s = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${fmtFixed(Math.abs(v), digits)}%`;
}

export function fmtSigned(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (!isNum(v)) return DASH;
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${fmtFixed(Math.abs(v), digits)}${suffix}`;
}

/** Odliczanie do zdarzenia: „za 2 h 14 min” / „za 38 min” / „teraz”. */
export function fmtCountdown(targetMs: number, nowMs: number): string {
  const d = Math.round((targetMs - nowMs) / 60000);
  if (d <= 0) return tr('teraz', 'now');
  if (d < 60) return tr(`za ${d} min`, `in ${d} min`);
  const h = Math.floor(d / 60);
  if (h < 48) return tr(`za ${h} h ${d % 60} min`, `in ${h} h ${d % 60} min`);
  return tr(`za ${Math.round(h / 24)} dni`, `in ${Math.round(h / 24)} days`);
}
