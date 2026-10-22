import { describe, expect, it } from 'vitest';
import { FILLS_WEIGHT, LiqConfirmer, PriceRange, isLiqCandidate, parseLiquidationFills } from '../liqDetect.ts';
import type { ScannedPosition } from '../../../src/utils/liqMap.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const ADDR = '0x' + '11'.repeat(20);
const OTHER = '0x' + '22'.repeat(20);

const pos = (szi: number, liqPx: number | null, scannedAt = T0): ScannedPosition => ({ szi, entryPx: 100_000, liqPx, scannedAt });

describe('PriceRange — minimum i maksimum ceny z taśmy w oknie', () => {
  it('zwraca skrajne ceny z minut w oknie; poza oknem ignoruje', () => {
    const r = new PriceRange();
    r.record(100_000, T0 + 10_000);
    r.record(99_500, T0 + MIN + 5_000);
    r.record(100_400, T0 + 2 * MIN + 1);
    r.record(90_000, T0 + 10 * MIN); // poza oknem
    expect(r.range(T0, T0 + 3 * MIN)).toEqual({ lo: 99_500, hi: 100_400 });
  });
  it('brak danych w oknie → null; dane starsze niż 24 h są usuwane', () => {
    const r = new PriceRange();
    r.record(100_000, T0);
    expect(r.range(T0 + MIN, T0 + 2 * MIN)).toBeNull();
    r.record(101_000, T0 + 25 * 60 * MIN);
    expect(r.range(T0 - MIN, T0 + MIN)).toBeNull();
  });
});

describe('PriceRange.firstTouch i trwałość', () => {
  it('pierwsza minuta, w której cena weszła w pasmo ceny likwidacji (long: od góry, short: od dołu)', () => {
    const r = new PriceRange();
    r.record(100_000, T0);
    r.record(95_600, T0 + MIN);
    r.record(95_100, T0 + 2 * MIN);
    r.record(94_000, T0 + 3 * MIN);
    expect(r.firstTouch(T0, T0 + 4 * MIN, 95_000, 'long')).toBe(T0 + 2 * MIN);
    expect(r.firstTouch(T0, T0 + 4 * MIN, 99_900, 'short')).toBe(T0);
    expect(r.firstTouch(T0, T0 + 4 * MIN, 80_000, 'long')).toBeNull();
  });
  it('zapis i odczyt zachowuje minuty z 24 h', () => {
    const r = new PriceRange();
    r.record(100_000, T0);
    r.record(99_000, T0 + MIN);
    const back = PriceRange.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    expect(back.range(T0, T0 + MIN)).toEqual({ lo: 99_000, hi: 100_000 });
    expect(PriceRange.fromJSON({ v: 9 }).range(T0, T0 + MIN)).toBeNull();
  });
});

describe('isLiqCandidate', () => {
  it('long zmniejszony, cena dotknęła ceny likwidacji → kandydat', () => {
    expect(isLiqCandidate(pos(2, 95_000), null, { lo: 94_990, hi: 96_000 })).toBe(true);
    expect(isLiqCandidate(pos(2, 95_000), pos(1, 94_000), { lo: 95_150, hi: 96_000 })).toBe(true); // w tolerancji 0.2%
  });
  it('short zmniejszony, cena doszła do ceny likwidacji z góry → kandydat', () => {
    expect(isLiqCandidate(pos(-3, 105_000), null, { lo: 103_000, hi: 105_010 })).toBe(true);
  });
  it('likwidacja wcześniejsza niż mapa (cena do 0.5% przed poziomem z mapy) też jest kandydatem', () => {
    expect(isLiqCandidate(pos(2, 95_000), null, { lo: 95_400, hi: 96_000 })).toBe(true);
    expect(isLiqCandidate(pos(-2, 105_000), null, { lo: 104_000, hi: 104_550 })).toBe(true);
  });
  it('cena daleko od ceny likwidacji → nie (zwykłe zamknięcie)', () => {
    expect(isLiqCandidate(pos(2, 95_000), null, { lo: 97_000, hi: 99_000 })).toBe(false);
  });
  it('pozycja bez zmniejszenia, bez ceny likwidacji albo bez danych o cenie → nie', () => {
    expect(isLiqCandidate(pos(2, 95_000), pos(2, 95_000), { lo: 94_000, hi: 96_000 })).toBe(false);
    expect(isLiqCandidate(pos(2, 95_000), pos(3, 95_000), { lo: 94_000, hi: 96_000 })).toBe(false);
    expect(isLiqCandidate(pos(2, null), null, { lo: 94_000, hi: 96_000 })).toBe(false);
    expect(isLiqCandidate(pos(2, 95_000), null, null)).toBe(false);
    expect(isLiqCandidate(null, null, { lo: 94_000, hi: 96_000 })).toBe(false);
  });
  it('odwrócenie pozycji (long → short) przy cenie likwidacji też jest kandydatem', () => {
    expect(isLiqCandidate(pos(2, 95_000), pos(-1, 120_000), { lo: 94_900, hi: 96_000 })).toBe(true);
  });
});

const fill = (o: Record<string, unknown>) => ({
  coin: 'BTC',
  px: '95000',
  sz: '1',
  side: 'A',
  time: T0 + 5 * MIN,
  startPosition: '2',
  dir: 'Close Long',
  closedPnl: '-5000',
  hash: '0x00',
  oid: 1,
  crossed: true,
  fee: '1',
  tid: 1,
  feeToken: 'USDC',
  ...o,
});

describe('parseLiquidationFills', () => {
  it('sumuje fille likwidacyjne konta: rozmiar, VWAP, pierwszy czas, mark i metoda', () => {
    const fills = [
      fill({ px: '95000', sz: '1', tid: 7, time: T0 + 5 * MIN, liquidation: { markPx: 94_980, method: 'market' } }),
      fill({ px: '94900', sz: '1', tid: 8, time: T0 + 5 * MIN + 200, liquidation: { liquidatedUser: ADDR, markPx: 94_950, method: 'market' } }),
      fill({ px: '96000', sz: '5', tid: 9, dir: 'Open Long' }), // zwykły fill — pomijany
      fill({ coin: 'ETH', tid: 10, liquidation: { markPx: 3000, method: 'market' } }), // inny rynek
    ];
    const e = parseLiquidationFills(fills, 'BTC', ADDR, pos(2, 95_000, T0));
    expect(e).not.toBeNull();
    expect(e!.side).toBe('long');
    expect(e!.sz).toBeCloseTo(2, 9);
    expect(e!.px).toBeCloseTo(94_950, 6);
    expect(e!.usd).toBeCloseTo(189_900, 3);
    expect(e!.t).toBe(T0 + 5 * MIN);
    expect(e!.markPx).toBe(94_980);
    expect(e!.method).toBe('market');
    expect(e!.mapLiqPx).toBe(95_000);
    expect(e!.mapAgeMin).toBeCloseTo(5, 9);
    expect(e!.tids).toEqual([7, 8]);
  });
  it('konto było likwidatorem (liquidatedUser = inny adres) → nie jest to likwidacja tego konta', () => {
    const fills = [fill({ liquidation: { liquidatedUser: OTHER, markPx: 94_980, method: 'backstop' } })];
    expect(parseLiquidationFills(fills, 'BTC', ADDR, pos(2, 95_000))).toBeNull();
  });
  it('wielkość liter adresu nie ma znaczenia; backstop rozpoznany', () => {
    const fills = [fill({ liquidation: { liquidatedUser: ADDR.toUpperCase().replace('0X', '0x'), markPx: 94_980, method: 'backstop' } })];
    expect(parseLiquidationFills(fills, 'BTC', ADDR, pos(2, 95_000))!.method).toBe('backstop');
  });
  it('brak fillów likwidacyjnych lub zły kształt → null', () => {
    expect(parseLiquidationFills([fill({})], 'BTC', ADDR, pos(2, 95_000))).toBeNull();
    expect(parseLiquidationFills({ error: 'x' }, 'BTC', ADDR, pos(2, 95_000))).toBeNull();
  });
});

describe('LiqConfirmer', () => {
  function fakeRest(responses: unknown[]) {
    const calls: unknown[] = [];
    const charged: number[] = [];
    return {
      calls,
      charged,
      info: async (body: unknown) => {
        calls.push(body);
        return responses.shift() ?? null;
      },
      charge: (w: number) => {
        charged.push(w);
      },
    };
  }

  it('potwierdza kandydata, zapisuje zdarzenie raz (deduplikacja po tid) i liczy wyniki', async () => {
    const liqFills = [fill({ tid: 7, liquidation: { markPx: 94_980, method: 'market' } })];
    const rest = fakeRest([liqFills, liqFills, [fill({})]]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + 6 * MIN });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + 7 * MIN }); // ten sam fill ponownie
    c.enqueue({ addr: OTHER, prev: pos(1, 95_000, T0), from: T0, to: T0 + 6 * MIN }); // zwykłe zamknięcie
    await c.process(rest, T0 + 8 * MIN);
    expect(rest.calls[0]).toEqual({ type: 'userFillsByTime', user: ADDR, startTime: T0 - 1000, endTime: T0 + 6 * MIN + 1000 });
    expect(c.events()).toHaveLength(1);
    // drugi kandydat nie wnosi nowych fillów — to ta sama likwidacja, nie liczy się podwójnie
    expect(c.checks(T0 + 8 * MIN)).toEqual({ candidates: 2, confirmed: 1, rejected: 1, failed: 0 });
  });

  it('likwidacja w dwóch krokach: drugie okno zawiera stary i nowy fill → nowe zdarzenie tylko z nowym fillem', async () => {
    const f1 = fill({ tid: 7, sz: '1', time: T0 + 5 * MIN, liquidation: { markPx: 94_980, method: 'market' } });
    const f2 = fill({ tid: 8, sz: '4', time: T0 + 5 * MIN + 30_000, liquidation: { markPx: 94_900, method: 'market' } });
    const rest = fakeRest([[f1], [f1, f2]]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(5, 95_000, T0), from: T0, to: T0 + 5 * MIN + 1000 });
    await c.process(rest, T0 + 6 * MIN);
    c.enqueue({ addr: ADDR, prev: pos(4, 95_000, T0 + 5 * MIN + 1000), from: T0 + 5 * MIN + 1000, to: T0 + 6 * MIN });
    await c.process(rest, T0 + 7 * MIN);
    expect(c.events().map((e) => e.sz)).toEqual([1, 4]);
    expect(c.checks(T0 + 7 * MIN).confirmed).toBe(2);
  });

  it('okno zapytania zaczyna się od pierwszego dotknięcia ceny (from), nie od starego odczytu', async () => {
    const rest = fakeRest([[fill({})]]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0 + 20 * MIN, to: T0 + 25 * MIN });
    await c.process(rest, T0 + 26 * MIN);
    expect(rest.calls[0]).toMatchObject({ startTime: T0 + 20 * MIN - 1000, endTime: T0 + 25 * MIN + 1000 });
  });

  it('dopłata wag za liczbę zwróconych fillów (20 + 1 na 20) ponad rezerwację', async () => {
    const many = Array.from({ length: 400 }, (_, i) => fill({ tid: 1000 + i }));
    const rest = fakeRest([many]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    await c.process(rest, T0 + 2 * MIN);
    expect(rest.charged).toEqual([20 + 20 - FILLS_WEIGHT]);
  });

  it('obcięta odpowiedź (≥ 2000 fillów) albo zły kształt → nieudane, nie „zamknięcie przez właściciela”', async () => {
    const full = Array.from({ length: 2000 }, (_, i) => fill({ tid: i }));
    const rest = fakeRest([full, { error: 'x' }, { error: 'x' }, { error: 'x' }]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    c.enqueue({ addr: OTHER, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    for (let i = 0; i < 3; i++) await c.process(rest, T0 + (2 + i) * MIN);
    expect(c.checks(T0 + 5 * MIN)).toEqual({ candidates: 2, confirmed: 0, rejected: 0, failed: 2 });
  });

  it('API przeciążone (limiter w wycofaniu) → bez zapytań, kandydaci czekają', async () => {
    const rest = { ...fakeRest([[fill({})]]), healthy: () => false };
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    expect(await c.process(rest, T0 + 2 * MIN)).toBe(0);
    expect(c.pending).toBe(1);
  });

  it('limit zapytań na minutę: nadmiar czeka w kolejce, przeterminowany (30 min) liczony jako nieudany', async () => {
    const rest = fakeRest([[fill({})], [fill({})]]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 1 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    c.enqueue({ addr: OTHER, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    await c.process(rest, T0 + 2 * MIN);
    expect(rest.calls).toHaveLength(1);
    await c.process(rest, T0 + 2 * MIN + 10_000);
    expect(rest.calls).toHaveLength(1); // ta sama minuta
    await c.process(rest, T0 + 40 * MIN);
    expect(rest.calls).toHaveLength(1); // przeterminowany, bez zapytania
    expect(c.checks(T0 + 40 * MIN)).toEqual({ candidates: 2, confirmed: 0, rejected: 1, failed: 1 });
  });

  it('błąd API → kandydat wraca do kolejki; po 3 próbach nieudany', async () => {
    const rest = fakeRest([null, null, null]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + MIN });
    for (let i = 0; i < 3; i++) await c.process(rest, T0 + (2 + i) * MIN);
    expect(rest.calls).toHaveLength(3);
    expect(c.pending).toBe(0);
    expect(c.checks(T0 + 5 * MIN).failed).toBe(1);
  });

  it('odczyt stanu odrzuca uszkodzone zdarzenia; zdarzenia z przyszłości i sprzed okresu obserwacji wypadają', () => {
    const good = { t: T0, side: 'long', sz: 1, px: 95_000, usd: 95_000, method: 'market', markPx: 95_000, mapLiqPx: 95_100, mapAgeMin: 2, tids: [5] };
    const back = LiqConfirmer.fromJSON(
      {
        v: 1,
        events: [good, { ...good, px: 'x', tids: [6] }, { ...good, side: 'up', tids: [7] }, { ...good, tids: ['8'] }, { ...good, t: T0 + 48 * 3600_000, tids: [9] }],
        log: [],
      },
      { coin: 'BTC', maxPerMin: 10 }
    );
    expect(back.events().map((e) => e.tids[0])).toEqual([5, 9]);
    back.prune(T0 + MIN);
    expect(back.events().map((e) => e.tids[0])).toEqual([5]);
    back.dropBefore(T0 + 1);
    expect(back.events()).toEqual([]);
  });

  it('zdarzenia i liczniki starsze niż 24 h wypadają; stan przetrwa zapis i odczyt bez adresów', async () => {
    const rest = fakeRest([[fill({ tid: 7, liquidation: { markPx: 94_980, method: 'market' } })]]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 10 });
    c.enqueue({ addr: ADDR, prev: pos(2, 95_000, T0), from: T0, to: T0 + 6 * MIN });
    await c.process(rest, T0 + 7 * MIN);
    const json = JSON.stringify(c.toJSON());
    expect(json).not.toContain(ADDR);
    const back = LiqConfirmer.fromJSON(JSON.parse(json), { coin: 'BTC', maxPerMin: 10 });
    expect(back.events()).toHaveLength(1);
    expect(back.checks(T0 + 7 * MIN).confirmed).toBe(1);
    back.prune(T0 + 25 * 60 * MIN);
    expect(back.events()).toHaveLength(0);
    expect(back.checks(T0 + 25 * 60 * MIN).candidates).toBe(0);
  });
});
