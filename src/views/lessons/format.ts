import { DASH } from '../../ui';

/** Formaty liczb zakładki Lekcje w języku treści. */

export const fmtUsd = (v: number, locale: string) => Math.round(v).toLocaleString(locale);

export const fmtPct = (v: number | null, locale: string, digits = 0) =>
  v === null ? DASH : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);

/** Punkty procentowe ze znakiem (różnica dwóch odsetków). */
export const fmtPp = (v: number | null, locale: string) =>
  v === null ? DASH : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero' }).format(v * 100).replace('-', '−')} pp`;

export const fmtNum = (v: number, locale: string, digits = 2) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v).replace('-', '−');

/** Wspólny wygląd przycisków zakładki. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3.5 rounded-md bg-accent/15 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/25 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none';
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3.5 rounded-md bg-surface-3 border border-line-strong text-ink-1 text-sm font-medium hover:bg-surface-2 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none';
export const BTN_LINK = 'inline-flex items-center gap-1 text-sm text-accent hover:underline underline-offset-2';
