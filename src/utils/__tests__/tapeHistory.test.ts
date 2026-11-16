import { describe, expect, it } from 'vitest';
import { type CtxSample, decodeCtx, encodeCtx, historyBaseOf } from '../tapeHistory';

describe('plik kontekstu rynku `ctx` (projekt 60, Q5)', () => {
  const T = Date.UTC(2026, 10, 16, 14, 0, 0);
  const s = (t: number, over: Partial<CtxSample> = {}): CtxSample => ({ t, mark: 3840, oracle: 3839.9, mid: 3840.05, impactBid: 3839.8, impactAsk: 3840.3, premium: 0.00002, ...over });

  it('zapis i odczyt: czas różnicowo, kolumny z null przy braku pola; kolejność rosnąca, pokrycie przycięte', () => {
    const xs = [s(T + 10_000), s(T + 5_000, { oracle: null, impactBid: null, impactAsk: null, mid: null, premium: null })];
    const f = encodeCtx('xyz:GOLD', T, T + 300_000, [[T - 1000, T + 400_000]], xs);
    expect(f.t).toEqual([T + 5_000, 5_000]);
    expect(f.oracle).toEqual([null, 3839.9]);
    const back = decodeCtx(JSON.parse(JSON.stringify(f)))!;
    expect(back.coin).toBe('xyz:GOLD');
    expect(back.spans).toEqual([[T, T + 300_000]]);
    expect(back.samples).toEqual([s(T + 5_000, { oracle: null, impactBid: null, impactAsk: null, mid: null, premium: null }), s(T + 10_000)]);
  });

  it('zły kształt albo wersja → null: różne długości kolumn, mark nie liczba, tekst w kolumnie liczb', () => {
    const f = encodeCtx('BTC', T, T + 300_000, [], [s(T)]);
    expect(decodeCtx({ ...f, v: 99 })).toBeNull();
    expect(decodeCtx({ ...f, oracle: [] })).toBeNull();
    expect(decodeCtx({ ...f, mark: [null] })).toBeNull();
    expect(decodeCtx({ ...f, premium: ['x'] })).toBeNull();
    expect(decodeCtx(null)).toBeNull();
  });
});

describe('historyBaseOf: adres gałęzi history repo danych', () => {
  it('…/hyperquant-data/main → …/hyperquant-data/history; adres bez „/main” (podgląd lokalny) bez zmian', () => {
    expect(historyBaseOf('https://raw.githubusercontent.com/rdemb/hyperquant-data/main')).toBe('https://raw.githubusercontent.com/rdemb/hyperquant-data/history');
    expect(historyBaseOf('http://localhost:8080/data')).toBe('http://localhost:8080/data');
    expect(historyBaseOf('')).toBe('');
  });
});
