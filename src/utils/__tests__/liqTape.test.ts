import { describe, expect, it } from 'vitest';
import { LiqEvent, buildLiqTape, calibErrorBp, isLiqEvent, isLiqTape, liqTapeFreshness } from '../liqTape';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function ev(over: Partial<LiqEvent> = {}): LiqEvent {
  return { t: NOW - 10 * MIN, side: 'long', sz: 2, px: 100_000, usd: 200_000, method: 'market', markPx: 100_000, mapLiqPx: 100_100, mapAgeMin: 3, ...over };
}
const CHECKS = { candidates: 5, confirmed: 3, rejected: 1, failed: 1 };

describe('calibErrorBp — błąd mapy względem rzeczywistej likwidacji', () => {
  it('long zlikwidowany głębiej niż mapa → dodatni błąd w bp', () => {
    // mapa: 100 100, mark przy likwidacji 100 000 → 10 bp głębiej
    expect(calibErrorBp(ev())).toBeCloseTo(9.99, 1);
  });
  it('short zlikwidowany przed poziomem z mapy → ujemny', () => {
    expect(calibErrorBp(ev({ side: 'short', markPx: 99_900, mapLiqPx: 100_000 }))).toBeCloseTo(-10, 5);
  });
  it('brak poziomu z mapy → null', () => {
    expect(calibErrorBp(ev({ mapLiqPx: null }))).toBeNull();
  });
});

describe('buildLiqTape', () => {
  it('sumy 1 h i 24 h per strona, zdarzenia od najnowszego, kubełki 5 min rosnąco', () => {
    const tape = buildLiqTape(
      [
        ev({ t: NOW - 10 * MIN, usd: 200_000 }),
        ev({ t: NOW - 3 * MIN, side: 'short', usd: 50_000 }),
        ev({ t: NOW - 5 * 60 * MIN, usd: 1_000_000 }),
        ev({ t: NOW - 25 * 60 * MIN, usd: 9e9 }), // poza 24 h
      ],
      { coin: 'BTC', asOf: NOW, since: NOW - 48 * 60 * MIN, checks: CHECKS }
    );
    expect(tape.totals.h1).toEqual({ longUsd: 200_000, shortUsd: 50_000, n: 2 });
    expect(tape.totals.h24).toEqual({ longUsd: 1_200_000, shortUsd: 50_000, n: 3 });
    expect(tape.events.map((e) => e.t)).toEqual([NOW - 3 * MIN, NOW - 10 * MIN, NOW - 5 * 60 * MIN]);
    expect(tape.buckets.map((b) => b.t)).toEqual([NOW - 5 * 60 * MIN, NOW - 10 * MIN, NOW - 5 * MIN]);
    expect(tape.buckets.every((b) => b.t % (5 * MIN) === 0)).toBe(true);
    expect(tape.checks).toEqual(CHECKS);
    expect(isLiqTape(tape)).toBe(true);
  });

  it('kalibracja: mediana |błędu| i mediana ze znakiem tylko ze zdarzeń z poziomem z mapy', () => {
    const tape = buildLiqTape(
      [
        ev({ markPx: 100_000, mapLiqPx: 100_000 }), // 0 bp
        ev({ markPx: 99_800, mapLiqPx: 100_000 }), // +20 bp
        ev({ markPx: 100_100, mapLiqPx: 100_000 }), // −10 bp
        ev({ mapLiqPx: null, mapAgeMin: null }),
      ],
      { coin: 'BTC', asOf: NOW, since: NOW - 60 * MIN, checks: CHECKS }
    );
    expect(tape.calib.n).toBe(3);
    expect(tape.calib.medAbsErrBp).toBeCloseTo(10, 5);
    expect(tape.calib.medSignedErrBp).toBeCloseTo(0, 5);
    expect(tape.calib.medAgeMin).toBe(3);
  });

  it('brak zdarzeń → zera i null, nadal poprawny dokument', () => {
    const tape = buildLiqTape([], { coin: 'BTC', asOf: NOW, since: NOW - 60 * MIN, checks: { candidates: 0, confirmed: 0, rejected: 0, failed: 0 } });
    expect(tape.events).toEqual([]);
    expect(tape.calib).toEqual({ n: 0, medAbsErrBp: null, p90AbsErrBp: null, medSignedErrBp: null, medAgeMin: null });
    expect(isLiqTape(tape)).toBe(true);
  });

  it('lista zdarzeń ograniczona do 200 najnowszych (sumy liczone ze wszystkich)', () => {
    const many = Array.from({ length: 250 }, (_, i) => ev({ t: NOW - i * 1000, usd: 1 }));
    const tape = buildLiqTape(many, { coin: 'BTC', asOf: NOW, since: NOW - 60 * MIN, checks: CHECKS });
    expect(tape.events).toHaveLength(200);
    expect(tape.totals.h24.n).toBe(250);
  });

  it('dokument nie zawiera adresów ani identyfikatorów transakcji', () => {
    const tape = buildLiqTape([{ ...ev(), user: '0x' + 'ab'.repeat(20), tids: [1, 2] } as LiqEvent], {
      coin: 'BTC',
      asOf: NOW,
      since: NOW - 60 * MIN,
      checks: CHECKS,
    });
    const s = JSON.stringify(tape);
    expect(s).not.toMatch(/0x[0-9a-f]{40}/i);
    expect(s).not.toMatch(/tids|user/);
  });
});

describe('publiczne zdarzenia — utrudnione łączenie z publiczną taśmą transakcji', () => {
  it('czas do minuty, rozmiar do 2 cyfr znaczących, ceny do dolara, wartość do 100 USD; sumy z dokładnych wartości', () => {
    const exact = ev({ t: NOW - 10 * MIN + 37_412, sz: 8.931, px: 81_101.37, usd: 724_316.3, markPx: 81_120.6, mapLiqPx: 81_150.2 });
    const tape = buildLiqTape([exact], { coin: 'BTC', asOf: NOW, since: NOW - 60 * MIN, checks: CHECKS });
    expect(tape.events[0]).toMatchObject({ t: NOW - 10 * MIN, sz: 8.9, px: 81_101, usd: 724_300, markPx: 81_121, mapLiqPx: 81_150 });
    expect(tape.totals.h1.longUsd).toBeCloseTo(724_316.3, 6);
    expect(isLiqEvent(tape.events[0])).toBe(true);
    expect(isLiqEvent({ ...tape.events[0], method: 'x' })).toBe(false);
  });
});

describe('isLiqTape', () => {
  it('odrzuca zły kształt', () => {
    expect(isLiqTape(null)).toBe(false);
    expect(isLiqTape({ v: 1, coin: 'BTC' })).toBe(false);
    const ok = buildLiqTape([ev()], { coin: 'BTC', asOf: NOW, since: NOW - MIN, checks: CHECKS });
    expect(isLiqTape({ ...ok, events: [{ ...ok.events[0], side: 'up' }] })).toBe(false);
    expect(isLiqTape({ ...ok, totals: { h1: ok.totals.h1 } })).toBe(false);
  });
});

describe('liqTapeFreshness', () => {
  const tape = (asOf: number) => buildLiqTape([], { coin: 'BTC', asOf, since: asOf - 60 * MIN, checks: CHECKS });
  it('do 10 min ready, do 60 min stale, dalej expired', () => {
    expect(liqTapeFreshness(tape(NOW - 9 * MIN), NOW)).toBe('ready');
    expect(liqTapeFreshness(tape(NOW - 11 * MIN), NOW)).toBe('stale');
    expect(liqTapeFreshness(tape(NOW - 61 * MIN), NOW)).toBe('expired');
  });
});
