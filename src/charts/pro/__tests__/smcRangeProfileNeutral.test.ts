import { expect, it } from 'vitest';
import { rangeProfileWidth, SmcRangeProfileLayer } from '../chart/smcRangeProfileLayer';
import { PRO, rgba } from '../chart/theme';
import { Coverage } from '../core/coverage';
import { Tape, type TradeRow } from '../core/tape';

const start = 120_000;
const price = 64_670;

function paint(trades: TradeRow[], compact = false) {
  const tape = new Tape();
  tape.insert(trades);
  const span = { from: start, to: trades[trades.length - 1].t + 1 };
  const layer = new SmcRangeProfileLayer(tape, new Coverage([[span.from, span.to]]), () => span, true, () => [], new Coverage(), () => span.to);
  // The chart spans 18 USD on 180 pixels; both 64,670 and 64,671 are in one 2 USD row.
  const width = rangeProfileWidth(compact);
  layer.setLayout(width, 0);
  layer.attached({
    chart: { paneSize: () => ({ width: 400, height: 180 }) },
    series: {
      coordinateToPrice: (y: number) => price + 10 - y / 10,
      priceToCoordinate: (px: number) => (price + 10 - px) * 10,
    },
  } as Parameters<typeof layer.attached>[0]);
  layer.updateAllViews();

  const deltaWidths: number[] = [];
  const visitBars: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const texts: string[] = [];
  const context = {
    fillStyle: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, strokeText() {},
    fillText(value: string) { texts.push(value); },
    fillRect(x: number, y: number, width: number, height: number) {
      if (this.fillStyle === PRO.buy || this.fillStyle === PRO.sell) deltaWidths.push(width);
      if ([rgba(PRO.buy, .65), rgba(PRO.sell, .65)].includes(this.fillStyle)) {
        visitBars.push({ x, y, width, height, color: this.fillStyle });
      }
    },
  };
  const renderer = layer.priceAxisPaneViews()[0].renderer()!;
  const target = { useMediaCoordinateSpace: (draw: (scope: object) => void) => draw({ context, mediaSize: { width, height: 180 } }) };
  renderer.draw(target as Parameters<typeof renderer.draw>[0]);
  return { labels: texts.slice(0, 2), deltaWidths: deltaWidths.filter(width => width > 0), texts, visitBars };
}

it.each([[1, 0], [-1, 0], [1, 60_000], [-1, 60_000]] as const)('plots a neutral row (first side %i, spacing %i ms)', (side, gap) => {
  const other = side === 1 ? -1 : 1;
  const fills: TradeRow[] = [
    { t: start, px: price, sz: .003, side, tid: 1 },
    { t: start + 1 + gap, px: price, sz: .001, side: other, tid: 2 },
    { t: start + 2 + 2 * gap, px: price, sz: .002, side: other, tid: 3 },
  ];
  expect(paint(fills)).toMatchObject({ labels: ['388', '0'], deltaWidths: [], visitBars: [] });
});

it.each([1, -1] as const)('keeps a real signed difference of 0.00001 USD (first side %i)', side => {
  const result = paint([
    { t: start, px: price + 1, sz: .00001, side, tid: 4 },
    { t: start + 1, px: price, sz: .00001, side: side === 1 ? -1 : 1, tid: 5 },
  ]);
  expect(result.labels[1]).toBe(side === 1 ? '+<0,01' : '−<0,01');
  expect(result.deltaWidths).toHaveLength(1);
});

it.each([false, true])('draws proportional visits from the middle of each cell (compact %s)', compact => {
  const trade = (tid: number, px: number, sz: number, side: TradeRow['side']): TradeRow =>
    ({ t: start + tid, tid, px, sz, side });
  const { visitBars, texts } = paint([
    trade(1, price, .01, 1),
    trade(2, price + 8, .01, 1), trade(3, price + 8, .01, -1),
    trade(4, price, .02, -1),
    trade(5, price + 8, .01, 1), trade(6, price + 8, .01, -1),
    trade(7, price, .01, 1), trade(8, price, .01, -1),
  ], compact);
  expect(visitBars).toHaveLength(2);
  const [buy, sell] = visitBars;
  const left = compact ? 0 : 116;
  const cell = (rangeProfileWidth(compact) - left) / 3;
  expect(buy.color).toBe(rgba(PRO.buy, .65));
  expect(buy.x).toBeCloseTo(left + cell * .5);
  expect(sell.color).toBe(rgba(PRO.sell, .65));
  expect(sell.x + sell.width).toBeCloseTo(left + cell * 1.5);
  expect(sell.width).toBeCloseTo(buy.width * 2);
  expect(sell.y).toBe(buy.y);
  expect(buy.height).toBe(2);
  expect(texts).toEqual(expect.arrayContaining(['+647*', '−1,3K', '0', '—']));
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
  expect(neutral.texts[4]).toBe('0*');
  expect(neutral.deltaWidths).toEqual([]);
  expect(neutral.visitBars).toEqual([]);
  for (const side of [1, -1] as const) {
    const tid = fills.length;
    const t = fills.at(-1)!.t + 20;
    const observed = paint([...fills, { t, px: price + 1, sz: .00001, side, tid },
      { t: t + 20, px: price, sz: .00001, side: side === 1 ? -1 : 1, tid: tid + 1 }]);
    const label = side === 1 ? '+<0,01' : '−<0,01';
    expect(observed.labels[1]).toBe(label);
    expect(observed.texts[4]).toBe(label + '*');
    expect(observed.deltaWidths).toHaveLength(1);
    expect(observed.visitBars).toHaveLength(1);
    expect(observed.visitBars[0].color).toBe(rgba(side === 1 ? PRO.buy : PRO.sell, .65));
  }
});
