import { describe, expect, it } from 'vitest';
import { FIXED_NOW, createFixtures } from './fixtures.mjs';

const fx = createFixtures(process.cwd());
const MIN = 60_000;

describe('dane stałe pomiaru układu (bez sieci, stały zegar)', () => {
  it('zegar stoi w nagranej dobie 24.10 (ostatnia pełna minuta kopii przy lekcjach), niezależnie od pory uruchomienia', () => {
    expect(new Date(FIXED_NOW).toISOString()).toBe('2026-10-24T21:29:20.000Z');
  });

  it('ta sama odpowiedź przy każdym zapytaniu (deterministycznie)', () => {
    const q = { type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: FIXED_NOW - 5000 * 3_600_000 } };
    expect(JSON.stringify(createFixtures(process.cwd()).respond(q))).toBe(JSON.stringify(fx.respond(q)));
  });

  it('świece 5m w nagranej dobie to OHLC i wolumen z minut kopii przy lekcjach; ostatnia świeca nie wychodzi poza zegar', () => {
    const list = fx.respond({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '5m', startTime: Date.UTC(2026, 9, 24, 19, 0), endTime: Date.UTC(2026, 9, 24, 23, 0) } });
    const first = list[0];
    expect(first.t).toBe(Date.UTC(2026, 9, 24, 19, 0));
    const m1 = fx.minutes('BTC').filter((m) => m[0] >= first.t && m[0] < first.t + 5 * MIN);
    expect(m1).toHaveLength(5);
    expect(Number(first.o)).toBe(m1[0][1]);
    expect(Number(first.h)).toBe(Math.max(...m1.map((m) => m[2])));
    expect(Number(first.l)).toBe(Math.min(...m1.map((m) => m[3])));
    expect(Number(first.c)).toBe(m1[4][4]);
    expect(Number(first.v)).toBeCloseTo(m1.reduce((a, m) => a + m[5], 0), 6);
    expect(list.at(-1).t).toBe(Date.UTC(2026, 9, 24, 21, 25));
  });

  it('poza nagraniem i dla innych rynków: świece syntetyczne, poprawne (h ≥ max(o,c), l ≤ min(o,c), dodatni wolumen), najwyżej 5000', () => {
    for (const coin of ['BTC', 'ETH', 'SOL', 'HYPE']) {
      const list = fx.respond({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: 0 } });
      expect(list.length, coin).toBe(5000);
      for (const c of list) {
        const [o, h, l, cl, v] = [c.o, c.h, c.l, c.c, c.v].map(Number);
        expect(h).toBeGreaterThanOrEqual(Math.max(o, cl));
        expect(l).toBeLessThanOrEqual(Math.min(o, cl));
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('kontekst rynków, arkusz z krokiem z cyfr znaczących i finansowanie w formacie API Hyperliquid', () => {
    const [meta, ctxs] = fx.respond({ type: 'metaAndAssetCtxs' });
    expect(meta.universe.map((u) => u.name)).toEqual(['BTC', 'ETH', 'SOL', 'HYPE']);
    expect(Number(ctxs[0].markPx)).toBe(fx.minutes('BTC').at(-1)[4]);
    const book = fx.respond({ type: 'l2Book', coin: 'BTC', nSigFigs: 4 });
    expect(book.levels[0]).toHaveLength(20);
    expect(book.levels[1]).toHaveLength(20);
    expect(Number(book.levels[1][1].px) - Number(book.levels[1][0].px)).toBe(10);
    expect(Number(book.levels[0][0].px)).toBeLessThan(Number(book.levels[1][0].px));
    expect(book.time).toBe(FIXED_NOW);
    const f = fx.respond({ type: 'fundingHistory', coin: 'BTC', startTime: FIXED_NOW - 24 * 3_600_000 });
    expect(f).toHaveLength(24);
    expect(f.every((x) => x.time <= FIXED_NOW && typeof x.fundingRate === 'string')).toBe(true);
  });

  it('nieznany rodzaj zapytania: pusta lista (żadne zapytanie nie idzie do sieci)', () => {
    expect(fx.respond({ type: 'outcomeMeta' })).toEqual([]);
  });
});
