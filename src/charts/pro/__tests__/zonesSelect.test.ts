import { describe, expect, it } from 'vitest';
import { FootprintBuilder } from '../core/footprintBar';
import { type ImbalanceZone, type UnfinishedAuction, type ZoneBar, dayZoneStep, imbalanceZones, unfinishedAuctions } from '../core/zones';
import { AUCTIONS_PER_SIDE, ZONES_EVIDENCE, ZONES_PER_SIDE, selectZones } from '../chart/zonesSelect';
import { closedZoneBars } from '../chart/zonesLayer';

const M5 = 5 * 60_000;
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 9, 22);
const IMB = { ratio: 3, minVol: 0 };

function bar(t: number, trades: [number, number, 1 | -1][], complete = true): ZoneBar {
  const b = new FootprintBuilder(t, 1);
  trades.forEach(([px, sz, side], i) => b.add(t + i, px, sz, side));
  const fp = b.build()!;
  return { t, high: fp.high, low: fp.low, fp, complete };
}

/** Świeca bez taśmy o zakresie `range` wokół 100 000. */
const plain = (t: number, range: number): ZoneBar => ({ t, low: 100_000 - range / 2, high: 100_000 + range / 2, fp: null, complete: false });

describe('strefy tylko ze świec zamkniętych i w całości nagranych', () => {
  const stacked = (complete: boolean) =>
    bar(0, [
      [100, 1, -1],
      [101, 1, -1],
      [102, 1, -1],
      [101, 4, 1],
      [102, 4, 1],
      [103, 4, 1],
    ], complete);

  it('świeca niepełna (w trakcie albo z luką w taśmie) nie tworzy strefy', () => {
    expect(imbalanceZones([stacked(true)], 1, IMB, 3)).toHaveLength(1);
    expect(imbalanceZones([stacked(false)], 1, IMB, 3)).toEqual([]);
  });

  it('do modelu idą tylko świece zamknięte: świeca w trakcie nie tworzy ani nie zamyka strefy', () => {
    const mk = (t: number) => ({ t, candle: { t, o: 1, h: 2, l: 0.5, c: 1, v: 1, n: 1 }, fp: null, complete: true, share: 1 });
    const bars = [mk(0), mk(M5), mk(2 * M5)];
    expect(closedZoneBars(bars as never, M5, 2 * M5 + 1000).map((b) => b.t)).toEqual([0, M5]);
    expect(closedZoneBars(bars as never, M5, 3 * M5).map((b) => b.t)).toEqual([0, M5, 2 * M5]);
  });
});

describe('krok siatki stały w obrębie doby UTC', () => {
  // Doba D0 — zakresy 120 (krok 10), D0+1 — zakresy 240 (krok 20)
  const bars: ZoneBar[] = [];
  for (let t = D0; t < D0 + 3 * DAY; t += M5) bars.push(plain(t, t < D0 + DAY ? 120 : 240));
  const withTick = bars.map((b, i) => (i === 0 ? { ...b, fp: bar(b.t, [[100_000, 1, 1]]).fp } : b));

  it('liczony o 00:00 UTC z mediany zakresu świec poprzedniej doby; stały między 00:00 a 24:00', () => {
    const step = dayZoneStep(withTick, 0);
    const day1 = withTick.filter((b) => b.t >= D0 + DAY && b.t < D0 + 2 * DAY).map((b) => step(b.t));
    expect(new Set(day1)).toEqual(new Set([10]));
    const day2 = withTick.filter((b) => b.t >= D0 + 2 * DAY).map((b) => step(b.t));
    expect(new Set(day2)).toEqual(new Set([20]));
  });

  it('doba bez pełnej poprzedniej doby w historii: bez stref (0), więc wynik nie zależy od głębokości historii', () => {
    const step = dayZoneStep(withTick, 0);
    expect(step(D0 + 3 * 60_000)).toBe(0);
    const shorter = withTick.slice(100);
    expect(dayZoneStep([{ ...shorter[0], fp: withTick[0].fp }, ...shorter.slice(1)], 0)(D0 + DAY + M5)).toBe(0);
    expect(dayZoneStep(withTick, 0)(D0 + 2 * DAY + M5)).toBe(dayZoneStep([{ ...withTick[288], fp: withTick[0].fp }, ...withTick.slice(289)], 0)(D0 + 2 * DAY + M5));
  });

  it('krok ręczny bez zmian (nie mniejszy niż tick)', () => {
    expect(dayZoneStep(withTick, 25)(D0 + 5)).toBe(25);
  });

  it('strefy i aukcje przyjmują krok jako funkcję czasu świecy', () => {
    expect(unfinishedAuctions([], () => 1)).toEqual([]);
    expect(imbalanceZones([], () => 1, IMB, 3)).toEqual([]);
  });
});

describe('wybór stref i aukcji do rysowania (selectZones)', () => {
  const z = (side: 1 | -1, lo: number, hi: number, from = 0, to: number | null = null): ImbalanceZone => ({ from, to, lo, hi, side, tests: 0 });
  const u = (end: 1 | -1, px: number, from = 0, to: number | null = null): UnfinishedAuction => ({ from, to, px, end });

  it('tylko strefy otwarte w chwili X, najwyżej 2 na stronę najbliższe ostatniemu zamknięciu; zamknięta znika', () => {
    const zs = [z(1, 90, 91), z(1, 95, 96), z(1, 97, 98), z(1, 80, 81), z(-1, 103, 104), z(-1, 110, 111), z(-1, 101, 102, 0, 5 * M5), z(1, 99, 99.5, 20 * M5)];
    const s = selectZones(zs, [], 100, 10 * M5, { history: false });
    expect(ZONES_PER_SIDE).toBe(2);
    expect(s.zones.map((x) => x.lo)).toEqual([97, 95, 103, 110]);
  });

  it('niedokończone aukcje: tylko otwarte, najwyżej 1 na stronę najbliższa cenie', () => {
    const us = [u(1, 105), u(1, 102), u(-1, 95), u(-1, 97), u(-1, 99, 0, 3 * M5)];
    const s = selectZones([], us, 100, 10 * M5, { history: false });
    expect(AUCTIONS_PER_SIDE).toBe(1);
    expect(s.auctions.map((x) => x.px)).toEqual([102, 97]);
  });

  it('równa odległość — młodsza; cena w strefie — odległość 0', () => {
    const s = selectZones([z(1, 95, 96, M5), z(1, 104, 105, 2 * M5), z(1, 99, 101, 0)], [], 100, 10 * M5, { history: false });
    expect(s.zones.map((x) => x.lo)).toEqual([99, 104]);
  });

  it('tryb „Historia”: wszystkie strefy i aukcje znane w chwili X (obrysy)', () => {
    const s = selectZones([z(1, 90, 91), z(1, 95, 96, 0, 2 * M5), z(-1, 103, 104, 20 * M5)], [u(1, 105), u(-1, 95, 0, M5)], 100, 10 * M5, { history: true });
    expect([s.zones.length, s.auctions.length, s.history]).toEqual([2, 2, true]);
  });

  it('opis: wynik sprawdzianu wobec losowego miejsca, PL i EN', () => {
    expect(ZONES_EVIDENCE.pl).toContain('w 14% przypadków, tak samo jak losowe miejsce (n 1 495, listopad 2026)');
    expect(ZONES_EVIDENCE.en).toContain('14% of cases, the same as a random place (n 1,495, November 2026)');
  });
});

describe('stałość wyboru stref', () => {
  // Trzy doby świec 5m z taśmą: deterministyczne transakcje z serią kupna albo sprzedaży co kilka świec
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const bars: ZoneBar[] = [];
  let px = 100_000;
  for (let t = D0; t < D0 + 3 * DAY; t += M5) {
    px += Math.round((rnd() - 0.5) * 60);
    const side: 1 | -1 = rnd() < 0.5 ? 1 : -1;
    const trades: [number, number, 1 | -1][] = [];
    for (let k = -6; k <= 6; k++) trades.push([px + k * 5, 1 + rnd(), -side as 1 | -1], [px + k * 5 + 5, (rnd() < 0.3 ? 5 : 1) * (1 + rnd()), side]);
    bars.push(bar(t, trades));
  }
  const at = (list: readonly ZoneBar[], X: number) => {
    const upto = list.filter((b) => b.t <= X);
    const step = dayZoneStep(upto, 0);
    const last = upto[upto.length - 1];
    return selectZones(imbalanceZones(upto, step, IMB, 3), unfinishedAuctions(upto, step), (last.high + last.low) / 2, X, { history: false });
  };

  /** Rysunek wyboru: położenie i strona (koniec i liczba testów z późniejszych świec nie są rysowane w chwili X). */
  const drawn = (x: ReturnType<typeof selectZones>) => ({
    zones: x.zones.map((z) => [z.from, z.lo, z.hi, z.side]),
    auctions: x.auctions.map((u) => [u.from, u.px, u.end]),
  });

  it('chwila X: ten sam wybór po dopisaniu świec i przy historii od początku poprzedniej doby', () => {
    for (const k of [400, 520, 650, 800]) {
      const X = bars[k].t;
      const ref = at(bars, X);
      expect(ref.zones.length + ref.auctions.length, `X=${k}`).toBeGreaterThan(0);
      const withMore = selectZones(
        imbalanceZones(bars, dayZoneStep(bars, 0), IMB, 3),
        unfinishedAuctions(bars, dayZoneStep(bars, 0)),
        (bars[k].high + bars[k].low) / 2,
        X,
        { history: false }
      );
      expect(drawn(withMore), `X=${k}, dopisane świece`).toEqual(drawn(ref));
      const prevDay = Math.floor(X / DAY) * DAY - DAY;
      expect(drawn(at(bars.filter((b) => b.t >= prevDay), X)), `X=${k}, krótsza historia`).toEqual(drawn(ref));
    }
  });
});
