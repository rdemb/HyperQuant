import { describe, expect, it } from 'vitest';
import { WAIT_TEXT } from '../../src/utils/sessionText';
import { BLOCK_MARK, DISCLAIMER, GUARD_MARGIN, blocked, envelope, fromGot, guardedCut, num, toToolResult } from '../src/envelope';

const NOW = Date.UTC(2026, 10, 4, 15, 0);
// Syntetyczny adres składany w teście (nigdy prawdziwy, nie występuje w źródle jako literał)
const ADDR = '0x' + 'a'.repeat(40);

const textOf = (r: { content?: unknown }) => {
  const c = (r.content as { type: string; text: string }[] | undefined)?.[0];
  return c?.type === 'text' ? c.text : '';
};

describe('num', () => {
  it('NaN to brak liczby z powodem „czekam na dane”, bez oznaczenia', () => {
    expect(num(Number.NaN, 'usd', 'LIVE')).toEqual({ value: null, unit: 'usd', badge: null, why: WAIT_TEXT });
  });

  it('nieskończoność i undefined to też brak; własny powód zostaje', () => {
    expect(num(Number.POSITIVE_INFINITY, 'price', 'LIVE').value).toBeNull();
    expect(num(undefined, 'pct', 'MODEL').badge).toBeNull();
    expect(num(null, 'usd', 'LIVE', { why: 'plik skanera niedostępny' }).why).toBe('plik skanera niedostępny');
  });

  it('liczba skończona zostaje z oznaczeniem, bez powodu; metoda i uwaga przechodzą', () => {
    expect(num(80_500, 'price', 'LIVE', { method: 'blog', note: 'poziom z wpisu' })).toEqual({
      value: 80_500,
      unit: 'price',
      badge: 'LIVE',
      why: null,
      method: 'blog',
      note: 'poziom z wpisu',
    });
  });
});

describe('fromGot', () => {
  it('Absent daje null z jego powodem, liczba daje Num z metodą', () => {
    expect(fromGot({ why: 'brak zakresu sesji' }, 'pct', 'MODEL')).toEqual({ value: null, unit: 'pct', badge: null, why: 'brak zakresu sesji' });
    expect(fromGot(undefined, 'pct', 'MODEL').why).toBe(WAIT_TEXT);
    expect(fromGot(1.25, 'ratio', 'MODEL', 'har')).toEqual({ value: 1.25, unit: 'ratio', badge: 'MODEL', why: null, method: 'har' });
  });
});

describe('toToolResult', () => {
  const ok = envelope('day_map', { coverage: num(100, 'pct', 'LIVE') }, [{ name: 'blog', url: 'https://hyperquant.tech/blog/maps.json', asOf: null }], NOW);

  it('adres w danych (także głęboko w tablicy) — isError z powodem blokady, bez przepuszczenia tekstu', () => {
    const r = toToolResult(envelope('day_map', { levels: [{ label: `poziom ${ADDR}` }] }, [], NOW));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('blokada treści');
    expect(JSON.stringify(r)).not.toContain(ADDR);
    expect(r.structuredContent).toBeUndefined();
  });

  it('adres w kluczu obiektu — też isError', () => {
    const r = toToolResult(envelope('whales', { byAddress: { [ADDR]: 1 } }, [], NOW));
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain(ADDR);
  });

  it('wezwanie do transakcji („kup teraz”) — isError', () => {
    const r = toToolResult(envelope('day_map', { why: 'kup teraz' }, [], NOW));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('blokada treści');
    expect(textOf(r)).not.toContain('kup teraz');
  });

  it('poprawna koperta: stopka, czas ISO UTC, tekst to JSON równy structuredContent', () => {
    const r = toToolResult(ok);
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.disclaimer).toBe(DISCLAIMER);
    expect(sc.asOf).toBe('2026-11-04T15:00:00.000Z');
    expect(sc.coin).toBe('BTC');
    expect(JSON.parse(textOf(r))).toEqual(sc);
  });

  it('guardedCut: bezpieczniki tylko na początku tekstu (przycięcie + zapas), więc długi tekst z zewnątrz nie przechodzi w całości przez wzorce', () => {
    const filler = 'awaria '.repeat(20);
    // Adres przecięty na granicy 140 znaków: zapas za granicą łapie go w całości
    expect(guardedCut(`${filler}${ADDR}`, 140)).toBe(BLOCK_MARK);
    // Adres daleko za przycięciem nie trafia do wyniku, więc nie blokuje (tekst 1 MB, sprawdzany tylko początek)
    const long = `${filler}${'x '.repeat(500_000)}${ADDR}`;
    expect(guardedCut(long, 140)).toBe(long.slice(0, 140));
    expect(GUARD_MARGIN).toBeGreaterThanOrEqual(42);
  });

  it('blocked: isError z nazwą narzędzia i powodem', () => {
    const r = blocked('day_map', 'błąd narzędzia: x');
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('day_map');
    expect(textOf(r)).toContain('błąd narzędzia: x');
  });
});
