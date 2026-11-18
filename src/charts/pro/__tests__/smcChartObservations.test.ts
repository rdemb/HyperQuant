import { expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../core/smcOrderflow';
import { contactMarks, observationCaption, pickSmcZone, printCoordinate } from '../chart/smcChartObservations';

const zone: FlowElement = { id: 'zone', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 4, expiresAt: 100000000 };
function setup(element = zone) {
  const journal = new ObservationJournal('BTC');
  const model = new SmcOrderflow(journal, 60000);
  journal.open(0, 0);
  model.update([element], [], 'up', 0);
  let tid = 0;
  const print = (time: number, px: number, observedAt = time, side: 1 | -1 = -1) => {
    journal.trades([{ time, px, sz: 1, side, tid: ++tid }], observedAt);
    model.update([element], [], 'up', observedAt);
  };
  return { journal, model, print };
}

it.each(['ob', 'fvg'] as const)('retains exact observed contact and retreat prints for the last three %s contacts', kind => {
  const { model, print } = setup({ ...zone, kind });
  for (let i = 0; i < 4; i++) {
    print(10 + i * 20, 100);
    print(15 + i * 20, 99.5);
    print(20 + i * 20, 102.5);
  }
  expect(model.current(zone.id)?.recent.map(c => [c.from, c.price, c.endedAt, c.retreatPrice])).toEqual([
    [30, 100, 40, 102.5], [50, 100, 60, 102.5], [70, 100, 80, 102.5],
  ]);
  expect(model.at(zone.id, 10)?.recent[0]).toMatchObject({ from: 10, price: 100, retreatPrice: null });
});

it('samples from real prints, gates on receipt, breaks after a late print and stops at a gap', () => {
  const { journal, model, print } = setup();
  print(100, 100, 200);
  print(10100, 102, 10110, 1);
  expect(model.trajectory(zone.id, 199)).toEqual([]);
  expect(model.trajectory(zone.id, 10110)).toEqual([
    { time: 100, observedAt: 200, vwap: 100, delta: -1, deltaUsd: -100, connect: false },
    { time: 10100, observedAt: 10110, vwap: 101, delta: 0, deltaUsd: 2, connect: true },
  ]);
  print(500, 98, 11000);
  print(20100, 104, 20100, 1);
  expect(model.trajectory(zone.id).at(-1)).toMatchObject({ time: 20100, vwap: 101, delta: 0, connect: false });
  journal.close(20500, 20600, 'disconnect');
  journal.open(21000, 21000);
  print(22000, 110);
  expect(model.trajectory(zone.id).at(-1)?.time).toBe(20100);
  expect(model.current(zone.id)?.complete).toBe(false);
  expect(model.at(zone.id, 10110)?.complete).toBe(true);
});

it('bounds retained paths independently of raw trade eviction', () => {
  const { model, print } = setup();
  for (let i = 0; i < 400; i++) print(1 + i * 10000, 100);
  const points = model.trajectory(zone.id);
  expect(points.length).toBeLessThanOrEqual(257);
  expect(points.at(-1)?.time).toBe(3990001);
  expect(model.trajectory(zone.id, 5).map(p => p.time)).toEqual([1]);
  expect(points[1].connect).toBe(false);
});

it('shows only observations known at the replay cursor, including the real retreat price', () => {
  const { model, print } = setup();
  print(100, 100, 150);
  print(200, 102, 250);
  expect(model.at(zone.id, 149)?.recent).toEqual([]);
  expect(contactMarks(model.at(zone.id, 150)!, 150)).toMatchObject([{ time: 100, price: 100, kind: 'contact' }]);
  expect(contactMarks(model.at(zone.id, 250)!, 250)).toMatchObject([
    { time: 100, price: 100, kind: 'contact' }, { time: 200, price: 102, kind: 'retreat' },
  ]);
  expect(observationCaption(model.current(zone.id)!)).toContain('1');
});

it('uses exact candle coverage and cycles overlapping touch targets deterministically', () => {
  const bars = [{ t: 0 }, { t: 60000 }, { t: 180000 }];
  expect(printCoordinate(bars, 60000, 60000, true)).toEqual({ logical: 1, bar: 1 });
  expect(printCoordinate(bars, 75000, 60000)).toEqual({ logical: 0.75, bar: 1 });
  expect(printCoordinate(bars, 150000, 60000)).toBeNull();
  const zones = [{ id: 'ob', x0: 0, x1: 100, y0: 20, y1: 40 }, { id: 'fvg', x0: 20, x1: 100, y0: 26, y1: 34 }];
  expect(pickSmcZone(zones, 70, 30, 12, null)).toBe('fvg');
  expect(pickSmcZone(zones, 70, 30, 12, 'fvg')).toBe('ob');
  expect(pickSmcZone(zones, 70, 30, 12, 'ob')).toBe('fvg');
  expect(pickSmcZone(zones, 70, 55, 12, null)).toBeNull();
});

it('stores a sweep retest at the observed print price, without inferring an approach across a gap', () => {
  const e: FlowElement = { ...zone, kind: 'sweep', lo: 100, hi: 100 };
  const { journal, model, print } = setup(e);
  print(20, 102);
  journal.close(25, 30, 'disconnect');
  journal.open(40, 40);
  print(50, 100);
  expect(model.current(e.id)?.sweep?.retest).toBeNull();
  print(60, 102);
  print(70, 100.05, 80);
  expect(model.at(e.id, 79)?.sweep?.retest).toBeNull();
  expect(model.at(e.id, 80)?.sweep).toMatchObject({ retest: 70, retestPrice: 100.05 });
  expect(model.events(e.id).filter(v => v.kind === 'retest')).toMatchObject([{ exchangeAt: 70, observedAt: 80 }]);
});
