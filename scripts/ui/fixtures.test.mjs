import { describe, expect, it } from 'vitest';
import { FIXED_NOW, createFixtures, registry, scaleMinutes } from './fixtures.mjs';
import { bookQuote, parseBtcOutcomes } from '../../src/utils/hip4';
import { isMarketRegistry, marketsOrDefault } from '../../src/utils/marketRegistry';
import { pickAssetCtx } from '../../src/charts/pro/hl/parse';

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

  it('rynki wynikowe HIP-4: 14 płynnych rynków BTC z progami wokół ceny (7 nad, 7 pod)', () => {
    const qs = parseBtcOutcomes(fx.respond({ type: 'outcomeMeta' }), FIXED_NOW);
    expect(qs).toHaveLength(14);
    const px = fx.minutes('BTC').at(-1)[4];
    expect(qs.filter((q) => q.K >= px)).toHaveLength(7);
    expect(qs.every((q) => bookQuote(fx.respond({ type: 'l2Book', coin: q.coin }))?.liquid)).toBe(true);
  });

  it('przeskalowanie minut: ostatnie zamknięcie równe celowi, ceny × k z zaokrągleniem, wolumen ÷ k, czas bez zmian', () => {
    const m1 = [
      [0, 100, 110, 90, 105, 2],
      [MIN, 105, 120, 100, 200, 4],
    ];
    expect(scaleMinutes(m1, 40, 3, 2)).toEqual([
      [0, 20, 22, 18, 21, 10],
      [MIN, 21, 24, 20, 40, 20],
    ]);
    expect(scaleMinutes([[0, 3, 3, 3, 3, 1]], 1, 2, 2)).toEqual([[0, 1, 1, 1, 1, 3]]);
    expect(scaleMinutes([[0, 1, 1, 1, 3, 1]], 1, 2, 2)[0][1]).toBe(0.33);
  });

  it('HYPE i xyz:NVDA: minuty BTC przeskalowane do ceny rynku (40 i 180), świece poprawne w nagranej dobie i poza nią', () => {
    const btc = fx.minutes('BTC');
    for (const [coin, px] of [['HYPE', 40], ['xyz:NVDA', 180]]) {
      const m = fx.minutes(coin);
      expect(m.map((x) => x[0])).toEqual(btc.map((x) => x[0]));
      expect(m.at(-1)[4]).toBe(px);
      for (const iv of ['1m', '1h']) {
        const list = fx.respond({ type: 'candleSnapshot', req: { coin, interval: iv, startTime: FIXED_NOW - 3000 * 3_600_000 } });
        expect(list.length, `${coin} ${iv}`).toBeGreaterThan(100);
        for (const c of list) {
          const [o, h, l, cl, v] = [c.o, c.h, c.l, c.c, c.v].map(Number);
          expect(h).toBeGreaterThanOrEqual(Math.max(o, cl));
          expect(l).toBeLessThanOrEqual(Math.min(o, cl));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(c.s).toBe(coin);
        }
      }
    }
  });

  it('rynek HIP-3 z odpowiedzi swojej giełdy (dex: "xyz"), arkusz i strumień; główna giełda bez rynków HIP-3', () => {
    const raw = fx.respond({ type: 'metaAndAssetCtxs', dex: 'xyz' });
    expect(raw[0].universe).toEqual([{ name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 10 }]);
    expect(pickAssetCtx(raw, 'xyz:NVDA')?.markPx).toBe(180);
    expect(fx.respond({ type: 'metaAndAssetCtxs', dex: 'abc' })).toEqual([{ universe: [] }, []]);
    const main = fx.respond({ type: 'metaAndAssetCtxs' })[0].universe;
    expect(main.find((u) => u.name === 'HYPE').szDecimals).toBe(2);
    expect(main.some((u) => u.name.includes(':'))).toBe(false);
    const book = fx.respond({ type: 'l2Book', coin: 'xyz:NVDA' });
    expect(Number(book.levels[1][0].px) - Number(book.levels[0][0].px)).toBeCloseTo(0.01, 6);
    const s = fx.stream();
    expect(s['activeAssetCtx|xyz:NVDA'].coin).toBe('xyz:NVDA');
    expect(s['l2Book|HYPE|']).toBeTruthy();
  });

  it('rejestr rynków: poprawny format markets.json, strona widzi xyz:NVDA (giełda xyz) i cztery stałe rynki', () => {
    const reg = registry();
    expect(isMarketRegistry(reg)).toBe(true);
    const list = marketsOrDefault(reg);
    expect(list.map((m) => m.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'SOL', 'xyz:NVDA']);
    expect(list.find((m) => m.coin === 'xyz:NVDA')).toMatchObject({ dex: 'xyz', szDecimals: 3, scanner: 'none', class: 'equity' });
    expect(list.find((m) => m.coin === 'HYPE')?.szDecimals).toBe(2);
  });

  it('nieznany rodzaj zapytania: pusta lista (żadne zapytanie nie idzie do sieci)', () => {
    expect(fx.respond({ type: 'userFills' })).toEqual([]);
  });
});
