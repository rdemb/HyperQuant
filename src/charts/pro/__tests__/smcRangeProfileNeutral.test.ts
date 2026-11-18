import { expect, it, vi } from 'vitest';
import { rangeProfileWidth, SmcRangeProfileLayer, type RangeProfileInfo } from '../chart/smcRangeProfileLayer';
import { PRO } from '../chart/theme';
import { Coverage } from '../core/coverage';
import { Tape, type TradeRow } from '../core/tape';

const start = 120_000;
const price = 64_670;

function paint(trades: TradeRow[], compact = false) {
  const tape = new Tape();
  tape.insert(trades);
  const span = { from: start, to: trades[trades.length - 1].t + 1 };
  const layer = new SmcRangeProfileLayer(tape, new Coverage([[span.from, span.to]]), () => span, true, () => [], new Coverage(), () => span.to);
  // The chart spans 18 USD on 180 pixels; both 64,670 and 64,671 fit in one row.
  const width = rangeProfileWidth(compact);
  const output: { info: RangeProfileInfo | null } = { info: null };
  layer.onInfo = info => { output.info = info; };
  layer.setLayout(width, 0);
  attach(layer);
  return { ...render(layer, width), info: output.info };
}

function attach(layer: SmcRangeProfileLayer) {
  layer.attached({
    chart: { paneSize: () => ({ width: 400, height: 180 }) },
    series: {
      coordinateToPrice: (y: number) => price + 10 - y / 10,
      priceToCoordinate: (px: number) => (price + 10 - px) * 10,
    },
    requestUpdate: () => layer.updateAllViews(),
  } as Parameters<typeof layer.attached>[0]);
  layer.updateAllViews();
}

function render(layer: SmcRangeProfileLayer, width: number) {
  const deltaWidths: number[] = [];
  const fills: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const texts: { value: string; x: number; y: number }[] = [];
  const context = {
    fillStyle: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, strokeText() {},
    fillText(value: string, x: number, y: number) { texts.push({ value, x, y }); },
    fillRect(x: number, y: number, width: number, height: number) {
      if (height === 2 && (this.fillStyle === PRO.buy || this.fillStyle === PRO.sell)) deltaWidths.push(width);
      fills.push({ x, y, width, height, color: this.fillStyle });
    },
  };
  const renderer = layer.priceAxisPaneViews()[0].renderer()!;
  const target = { useMediaCoordinateSpace: (draw: (scope: object) => void) => draw({ context, mediaSize: { width, height: 180 } }) };
  renderer.draw(target as Parameters<typeof renderer.draw>[0]);
  return { labels: texts.slice(0, 2).map(t => t.value), deltaWidths: deltaWidths.filter(width => width > 0), texts, fills };
}

it.each([[1, 0], [-1, 0], [1, 60_000], [-1, 60_000]] as const)('plots a neutral row (first side %i, spacing %i ms)', (side, gap) => {
  const other = side === 1 ? -1 : 1;
  const fills: TradeRow[] = [
    { t: start, px: price, sz: .003, side, tid: 1 },
    { t: start + 1 + gap, px: price, sz: .001, side: other, tid: 2 },
    { t: start + 2 + 2 * gap, px: price, sz: .002, side: other, tid: 3 },
  ];
  expect(paint(fills)).toMatchObject({ labels: ['388', '0'], deltaWidths: [] });
});

it.each([false, true])('zachowuje oba kierunki w śladzie przy delcie 0 (kompakt %s)', compact => {
  const view = paint([
    { t: start, px: price, sz: 1, side: 1, tid: 1 },
    { t: start + 1, px: price, sz: 1, side: -1, tid: 2 },
  ], compact);
  const sell = view.fills.find(f => f.height === 3 && f.color === PRO.sell);
  const buy = view.fills.find(f => f.height === 3 && f.color === PRO.buy);
  expect(view.labels).toEqual(['129,3K', '0']);
  expect(view.deltaWidths).toEqual([]);
  expect(sell).toBeDefined();
  expect(buy).toBeDefined();
  expect(sell!.x + sell!.width).toBeCloseTo(buy!.x);
  expect(sell!.width).toBeCloseTo(buy!.width);
  expect(buy!.y).toBeGreaterThan(view.fills.find(f => f.height === 2)!.y + 2);
});

it.each([false, true])('przesuwa ślad z zegarem i respektuje pauzę oraz cofnięcie (powtórka %s)', replay => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    const tape = new Tape();
    tape.insert([
      { t: start + 1, px: price, sz: 1, side: 1, tid: 1 },
      { t: start + 31_000, px: price, sz: 1, side: -1, tid: 2 },
    ]);
    let now = start + 29_500, playing = true;
    const width = rangeProfileWidth(true);
    const layer = new SmcRangeProfileLayer(tape, new Coverage([[start, Infinity]]), () => ({ from: start, to: now }),
      replay, () => [], new Coverage(), () => now, () => playing);
    layer.setLayout(width, 0);
    attach(layer);
    const sides = () => render(layer, width).fills.filter(f => f.height === 3 && (f.color === PRO.buy || f.color === PRO.sell)).map(f => f.color);
    expect(sides()).toEqual([PRO.buy]);
    now += 600;
    vi.advanceTimersByTime(600);
    expect(sides()).toEqual([PRO.buy]);
    vi.advanceTimersByTime(400);
    expect(sides()).toEqual([]);
    // Cofnięcie usuwa przyszłe wykonania niezależnie od czasu, który upłynął w przeglądarce.
    playing = false;
    layer.setCutoff(start + 2_000);
    expect(sides()).toEqual([PRO.buy]);
    now += 40_000;
    vi.advanceTimersByTime(40_000);
    expect(sides()).toEqual([PRO.buy]);
    layer.setTraceVisible(false);
    expect(sides()).toEqual([]);
    expect(render(layer, width).labels[1]).not.toBe('0');
    layer.detached();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it.each([1, -1] as const)('keeps a real signed difference of 0.00001 USD (first side %i)', side => {
  const result = paint([
    { t: start, px: price + 1, sz: .00001, side, tid: 4 },
    { t: start + 1, px: price, sz: .00001, side: side === 1 ? -1 : 1, tid: 5 },
  ]);
  expect(result.labels[1]).toBe(side === 1 ? '+<0,01' : '−<0,01');
  expect(result.deltaWidths).toHaveLength(1);
});

it.each([false, true])('draws two aligned numbers on a plain background with bars below (compact %s)', compact => {
  const trade = (tid: number, px: number, sz: number, side: TradeRow['side']): TradeRow =>
    ({ t: start + tid, tid, px, sz, side });
  const { fills, texts, info } = paint([
    trade(1, price, .01, 1),
    trade(2, price + 8, .01, 1), trade(3, price + 8, .01, -1),
    trade(4, price, .02, -1),
    trade(5, price + 8, .01, 1), trade(6, price + 8, .01, -1),
    trade(7, price, .01, 1), trade(8, price, .01, -1),
  ], compact);
  expect(fills[0]).toEqual({ x: 0, y: 0, width: rangeProfileWidth(compact), height: 180, color: PRO.bg });
  expect(texts.map(t => t.value)).toEqual(['2,6K', '0', '3,2K', '−647', 'Obrót USD', 'Δ USD']);
  expect(texts[0].x).toBe(texts[2].x);
  expect(texts[1].x).toBe(texts[3].x);
  expect(texts[0].y).toBe(texts[1].y);
  expect(fills.filter(f => f.height === 2).every(f => !texts.some(t => Math.abs(f.y - t.y) <= 6))).toBe(true);
  expect(fills.filter(f => f.height === 2)).toHaveLength(3);
  expect(info?.active?.visits).toEqual({ count: 3, deltaMicros: -646_700_000n, partial: true });
});

it.each([0, 60_000])('keeps exact zero and both tiny signs after 1651 fills (minute offset %i)', offset => {
  const fills: TradeRow[] = [];
  const push = (px: number, sz: number, side: TradeRow['side']) => {
    const tid = fills.length;
    fills.push({ t: start + tid * 20 + (tid >= 1575 ? offset : 0), px, sz, side, tid });
  };
  for (let i = 0; i < 75; i++) push(price, 1, 1);
  for (let i = 0; i < 1500; i++) push(price, .00111, 1);
  for (let i = 0; i < 75; i++) push(price, 1, -1);
  push(price, 1.665, -1);

  const neutral = paint(fills);
  expect(neutral.labels[1]).toBe('0');
  expect(neutral.deltaWidths).toEqual([]);
  expect(neutral.info?.active?.visits).toEqual({ count: 1, deltaMicros: 0n, partial: true });
  for (const side of [1, -1] as const) {
    const tid = fills.length;
    const t = fills.at(-1)!.t + 20;
    const observed = paint([...fills, { t, px: price + 1, sz: .00001, side, tid },
      { t: t + 20, px: price, sz: .00001, side: side === 1 ? -1 : 1, tid: tid + 1 }]);
    const label = side === 1 ? '+<0,01' : '−<0,01';
    expect(observed.labels[1]).toBe(label);
    expect(observed.deltaWidths).toHaveLength(1);
    expect(observed.info?.active?.visits).toEqual({ count: 1, deltaMicros: BigInt(side) * 10n, partial: true });
  }
});
