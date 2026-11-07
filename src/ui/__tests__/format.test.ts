import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtAxisPrice } from '../../charts/orderflow/renderer';
import { fmtCompact, fmtFixed, fmtPct, fmtPrice, fmtSigned } from '../format';

/** Dawny zapis fmtFixed (formatter Intl budowany przy każdym wywołaniu) — wzorzec zgodności bajt w bajt. */
function legacyFixed(v: number, d: number, en: boolean): string {
  const s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (en ? s : s.replace(/,/g, ' ').replace(/\./g, ',')).replace(/^-/, '−');
}

/** Dawny fmtAxisPrice (bez zamiany znaku minus). */
function legacyAxis(p: number, step: number, en: boolean): string {
  const d = step < 1 ? 1 : 0;
  const s = p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return en ? s : s.replace(/,/g, ' ').replace(/\./g, ',');
}

const VALUES = [
  0, -0, 0.004, -0.004, 0.05, -0.05, 0.5, -0.5, 1, -1, 1.005, 2.675, 9.995, -9.995, 12.3456, -12.3456, 999.95, 999.949, 1000, -1000,
  80_768.45, -80_768.45, 1_234_567.891, -1_234_567.891, 9.87654321e9, 1e15, -1e15, 1e21, 1.23456e-5, Number.MAX_SAFE_INTEGER,
  Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN,
];
const DIGITS = [0, 1, 2, 3, 4];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('fmtFixed z formatterem w pamięci', () => {
  it('po polsku zapis identyczny jak dawny toLocaleString (wartości × miejsca po przecinku)', () => {
    for (const d of DIGITS) for (const v of VALUES) expect(fmtFixed(v, d), `${v} / ${d}`).toBe(legacyFixed(v, d, false));
  });

  it('po angielsku zapis identyczny jak dawny toLocaleString', async () => {
    // Język strony ustalany przy imporcie i18n: zapisany wybór „en” w przeglądarce
    vi.stubGlobal('document', {});
    vi.stubGlobal('localStorage', { getItem: () => 'en' });
    vi.resetModules();
    const i18n = await import('../../i18n');
    const en = await import('../format');
    expect(i18n.lang).toBe('en');
    for (const d of DIGITS) for (const v of VALUES) expect(en.fmtFixed(v, d), `${v} / ${d}`).toBe(legacyFixed(v, d, true));
  });

  it('funkcje oparte na fmtFixed dają te same napisy co dawniej', () => {
    expect(fmtPrice(80_768.45)).toBe(legacyFixed(80_768.45, 1, false));
    expect(fmtPrice(-3.14159, 3)).toBe(legacyFixed(-3.14159, 3, false));
    expect(fmtCompact(-12_345_678, '$')).toBe(`−$${legacyFixed(12.345678, 1, false)}M`);
    expect(fmtCompact(4_200_000_000)).toBe(`${legacyFixed(4.2, 2, false)}B`);
    expect(fmtCompact(12_900)).toBe(`${legacyFixed(12.9, 1, false)}K`);
    expect(fmtPct(-0.1234)).toBe(`−${legacyFixed(0.1234, 2, false)}%`);
    expect(fmtSigned(1_234.56, 1, ' USD')).toBe(`+${legacyFixed(1_234.56, 1, false)} USD`);
  });

  it('fmtAxisPrice (oś ceny przepływu) bez zmian, także dla liczb ujemnych', () => {
    for (const step of [0.5, 1]) for (const v of VALUES) expect(fmtAxisPrice(v, step), `${v} / ${step}`).toBe(legacyAxis(v, step, false));
  });

  it('wielokrotnie szybszy od toLocaleString z opcjami (podpisy płócien przy każdym odświeżeniu)', () => {
    const N = 20_000;
    const xs = Array.from({ length: N }, (_, i) => ((i * 7919.37) % 100_000) - 50_000);
    let sink = 0;
    // Rozgrzewka obu ścieżek (JIT)
    for (let i = 0; i < 2_000; i++) sink += legacyFixed(xs[i], i % 4, false).length + fmtFixed(xs[i], i % 4).length;
    let a = performance.now();
    for (let i = 0; i < N; i++) sink += legacyFixed(xs[i], i % 4, false).length;
    const legacyMs = performance.now() - a;
    a = performance.now();
    for (let i = 0; i < N; i++) sink += fmtFixed(xs[i], i % 4).length;
    const ms = performance.now() - a;
    expect(sink).toBeGreaterThan(0);
    expect(ms * 5).toBeLessThan(legacyMs);
  });
});
