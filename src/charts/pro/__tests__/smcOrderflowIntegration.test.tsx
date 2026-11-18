import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SmcLayer } from '../chart/smcLayer';
import { flowElements, flowId, flowAlignment } from '../chart/smcOrderflowAdapter';
import { SmcFlowDetails, SmcOrderflowPanel } from '../chart/SmcOrderflowPanel';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../core/smcOrderflow';
import { smcStructure, type SBar } from '../core/smcStructure';
import { indicatorDef } from '../indicators/registry';

const style = { alpha: 1, width: 1, internalLen: 3, swingLen: 10, higher: -1, history: true };
function walk(): SBar[] {
  let seed = 5, c = 100;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: 700 }, (_, i) => {
    const o = c; c = o + (random() - .5) * 1.6;
    return { t: i * 300000, o, h: Math.max(o, c) + random() * .5, l: Math.min(o, c) - random() * .5, c };
  });
}
it('connects real structure outputs to the shared journal, chart pick and five UI controls', () => {
  const bars = walk(), now = 700 * 300000, structure = smcStructure(bars, 300000);
  const all = flowElements(structure);
  for (const kind of ['ob', 'sweep', 'fvg']) expect(all.some(x => x.kind === kind), kind).toBe(true);
  expect(all.every(e => e.known >= 0)).toBe(true);
  const layer = new SmcLayer(() => style), journal = new ObservationJournal('BTC');
  journal.open(now, now); layer.setObservations(journal);
  layer.setData(bars.map(b => ({ t: b.t, candle: { ...b, v: 1, n: 1 } })), 300000, now);
  const sel = layer.selection()!, model = layer.observationModel()!;
  expect(model.stats().elements).toBeLessThanOrEqual(64);
  for (const { o, endAt } of sel.obs) {
    const id = flowId('ob', o.t, o.known, o.dir);
    expect(model.current(id)).toBeTruthy();
    const picked = layer.pickObservation((o.known + (endAt ?? now)) / 2, (o.lo + o.hi) / 2, 0);
    expect(picked).toBeTruthy(); expect(model.current(picked!)?.kind).toBe('ob');
  }
  const params = indicatorDef('smc').params;
  for (const key of ['defense', 'initiative', 'anchored', 'formation', 'memory']) expect(params.some(p => p.key === key && p.def === 1)).toBe(true);
  const selected = model.list()[0]; expect(selected).toBeTruthy();
  const html = renderToStaticMarkup(<SmcOrderflowPanel model={model} selected={selected.id} opts={style} unit="BTC" onSelect={() => {}} onOption={() => {}} onClose={() => {}} />);
  expect(html).toContain('data-flow-section="memory"'); expect(html).toContain('Co się zmieniło');
  expect(html).toContain('tylko tej sesji strony'); expect(html).not.toContain('NaN');
  layer.setData([], 60000, now + 250);
  expect(layer.observationModel()).not.toBe(model);
  expect(layer.observationModel()?.list()).toEqual([]);
});

it('renders each of five feature paths and keeps zero-volume VWAP unavailable', () => {
  for (const kind of ['ob', 'sweep', 'fvg'] as const) {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000);
    const e: FlowElement = { id: kind, kind, dir: 1, lo: 99, hi: 101, atr: 1, known: 0, expiresAt: 1e9 };
    m.update([e], [], 'up', 0); const s = m.current(kind)!;
    const html = renderToStaticMarkup(<SmcFlowDetails s={s} opts={style} unit="BTC" />);
    expect(html).toContain('data-flow-section="anchored"');
    expect(html).toContain(`data-flow-section="${kind === 'ob' ? 'defense' : kind === 'sweep' ? 'initiative' : 'formation'}"`);
    expect(html).not.toMatch(/NaN|Infinity/); expect(flowAlignment(s)).toBe('unavailable');
    const hidden = renderToStaticMarkup(<SmcFlowDetails s={s} opts={{ ...style, defense: false, initiative: false, anchored: false, formation: false }} unit="BTC" />);
    expect(hidden).not.toContain('data-flow-section');
  }
});

it('shows a physically consistent 5m FVG from real structure through retained public observations to UI', () => {
  const ms = 300000, end = 25 * ms;
  const j = new ObservationJournal('BTC', { trades: 10, books: 10 }); j.open(0, 0);
  const bars: SBar[] = Array.from({ length: 25 }, (_, i) => {
    const price = i < 22 ? 100 : i === 22 ? 98 : i === 23 ? 100 : 102;
    return { t: i * ms, o: price, c: price, h: price + .5, l: price - .5 };
  });
  for (let t = 0; t < end; t += 5000) {
    const i = Math.floor(t / ms), base = bars[i].c, origin = i >= 22, sz = origin ? 1 : 10;
    const nth = (t % ms) / 5000, px = base + (nth === 1 ? .5 : nth === 2 ? -.5 : 0);
    j.trades([{ time: t, tid: t, px, sz: origin ? 100 : 1, side: 1 }], t);
    j.book({ time: t, bids: [1, 2, 3, 4].map(d => ({ px: base - d, sz })), asks: [1, 2, 3, 4].map(d => ({ px: base + d, sz })) }, t, 1);
  }
  const layer = new SmcLayer(() => style); layer.setObservations(j);
  layer.setData(bars.map((b, i) => ({ t: b.t, candle: { ...b, v: i >= 22 ? 6000 : 60, n: 60 } })), ms, end);
  const f = layer.selection()?.fvgs.find(v => v.f.known === end)?.f;
  expect(f).toMatchObject({ lo: 98.5, hi: 101.5, dir: 1 });
  const s = layer.observationModel()!.current(flowId('fvg', f!.t, f!.known, f!.dir))!;
  // Środkowa świeca600000USD + dwa druki na włączonych brzegach9850+10150USD.
  expect(s.fvg).toMatchObject({ flowReferences: 20, depthReferences: 20, totalUsd: 1800000, insideUsd: 620000, strongFlow: true, lowLiquidity: true });
  expect(s.fvg?.share).toBeCloseTo(620000 / 1800000); expect(j.stats().trades).toBe(10); expect(j.stats().books).toBe(10);
  const html = renderToStaticMarkup(<SmcFlowDetails s={s} opts={style} unit="BTC" />);
  expect(html).toContain('Silny przepływ przy powstaniu'); expect(html).toContain('Mała widoczna płynność');
});
