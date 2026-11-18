import React, { Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '../../src/index.css';
import { ObservationJournal } from '../../src/charts/pro/core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../../src/charts/pro/core/smcOrderflow';
import { SmcOrderflowPanel } from '../../src/charts/pro/chart/SmcOrderflowPanel';
import { tr } from '../../src/i18n';
import { SmcLayer } from '../../src/charts/pro/chart/smcLayer';
import type { SmcSourceBar } from '../../src/charts/pro/chart/smcLayer';
import { smcObjects } from '../../src/charts/pro/chart/smcSelect';

const T0 = Date.UTC(2026, 10, 17, 18), ms = 300000, end = T0 + 125 * 60000;
const j = new ObservationJournal('BTC'); j.open(T0, T0);
for (let t = T0; t < end; t += 5000) {
  const origin = t >= end - 3 * ms;
  j.trades([{ time: t, tid: t, px: 100, sz: origin ? 100 : 1, side: 1 }], t);
  j.book({ time: t, bids: [{ px: 99, sz: origin ? 1 : 10 }, { px: 98, sz: 1 }], asks: [{ px: 101, sz: origin ? 1 : 10 }, { px: 102, sz: 1 }] }, t, 1);
}
const elements: FlowElement[] = [
  { id: 'ob', kind: 'ob', known: end, lo: 99, hi: 101, dir: 1, atr: 1, expiresAt: end + 1e9 },
  { id: 'sweep', kind: 'sweep', known: end, lo: 100, hi: 100, dir: 1, atr: 1, expiresAt: end + 1e9 },
  { id: 'fvg', kind: 'fvg', known: end, originFrom: end - 3 * ms, lo: 99, hi: 101, dir: 1, atr: 1, expiresAt: end + 1e9 },
  ...Array.from({ length: 17 }, (_, i): FlowElement => ({ id: `extra:${i}`, kind: 'ob', known: end, lo: 99, hi: 101, dir: 1, atr: 1, expiresAt: end + 1e9 })),
];
const model = new SmcOrderflow(j, ms, .1); model.update(elements, [], 'up', end);
const prints = [[100, 100, -1], [102, 500, 1], [100, 120, -1], [102, 500, 1], [99, 1, -1], [100, 10, -1], [99, 10000, -1]];
prints.forEach(([px, sz, side], i) => { const t = end + (i + 1) * 1000; j.trades([{ time: t, tid: t, px, sz, side: side as 1 | -1 }], t); model.update(elements, [], 'up', t); });
const bars = [0, 1, 2].map(i => ({ t: end + i * ms, o: 99, h: 100, l: 98, c: 99 }));
model.update(elements, bars, 'up', end + 3 * ms);
const styles = { alpha: 1, width: 1, internalLen: 3, swingLen: 10, defense: true, initiative: true, anchored: true, formation: true, memory: true };
const root = createRoot(document.getElementById('root')!);
function Preview() {
  const [selected, select] = useState('ob'), [opts, setOpts] = useState(styles), [open, setOpen] = useState(true);
  return <main className="min-h-screen bg-surface-1 p-4 text-ink-1" data-theme="dark"><h1 className="font-semibold">SIM · {tr('Weryfikacja pięciu funkcji SMC', 'Five SMC features verification')}</h1>
    <p className="mb-3 text-xs text-ink-3">{tr('Dane syntetyczne, rzeczywisty model i komponent panelu. Bez połączeń z giełdą.', 'Synthetic data, actual model and panel component. No exchange connections.')}</p>
    <div className="flex flex-wrap gap-2">{['ob', 'sweep', 'fvg'].map(id => <button key={id} className="min-h-11 rounded-lg border border-white/20 px-4" onClick={() => { select(id); setOpen(true); }}>{id.toUpperCase()}</button>)}</div>
    <div className="relative mt-3 h-[680px] w-full rounded-xl border border-white/10 bg-surface-2 sm:w-[520px]">
      {open && <SmcOrderflowPanel model={model} selected={selected} opts={opts} unit="BTC" onSelect={select} onOption={(key, on) => setOpts(o => ({ ...o, [key]: on }))} onClose={() => setOpen(false)} />}
    </div><div id="benchmark-host" className="relative h-[680px] w-full sm:w-[520px]" /></main>;
}
root.render(<Preview />);
const percent = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
async function benchmark() {
  const target = document.getElementById('benchmark-host')!;
  const baseHost = document.createElement('div'), fullHost = document.createElement('div');
  baseHost.className = fullHost.className = 'relative h-[680px] w-[520px]'; target.append(baseHost, fullHost);
  const baselineRoot = createRoot(baseHost), benchmarkRoot = createRoot(fullHost);
  const base: number[] = [], full: number[] = [], extra: number[] = [];
  const reactBase: number[] = [], reactFull: number[] = [];
  let measured = 0;
  const noop = () => {};
  const onRender: React.ProfilerOnRenderCallback = (_id, _phase, duration) => { measured = duration; };
  let c = 100, seed = 5;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const source: SmcSourceBar[] = Array.from({ length: 700 }, (_, i) => {
    const o = c; c += (random() - .5) * 1.6;
    const t = end - (700 - i) * ms;
    return { t, candle: { t, o, h: Math.max(o, c) + random() * .5, l: Math.min(o, c) - random() * .5, c, v: 1, n: 1 } };
  });
  const baseLayer = new SmcLayer(() => styles), fullLayer = new SmcLayer(() => styles);
  fullLayer.setObservations(j);
  const high = Math.max(...source.map(b => b.candle.h)), low = Math.min(...source.map(b => b.candle.l));
  const fakeChart = { timeScale: () => ({ logicalToCoordinate: (i: number) => (i - 540) * 4 }), paneSize: () => ({ width: 700, height: 480 }) };
  const fakeSeries = { priceToCoordinate: (p: number) => (high - p) / (high - low) * 480 };
  for (const layer of [baseLayer, fullLayer]) {
    layer.attached({ chart: fakeChart, series: fakeSeries, requestUpdate: noop } as unknown as Parameters<SmcLayer['attached']>[0]);
    layer.setData(source, ms, end);
  }
  const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  const draw = (layer: SmcLayer) => {
    ctx.clearRect(0, 0, 700, 480); layer.updateAllViews();
    for (const view of layer.paneViews()) {
      const renderer = view.renderer(); if (!renderer) continue;
      const target = { useMediaCoordinateSpace: (fn: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void) => fn({ context: ctx, mediaSize: { width: 700, height: 480 } }) };
      renderer.draw(target as unknown as Parameters<typeof renderer.draw>[0]);
    }
  };
  const view = (withPanel: boolean, i: number) => <Profiler id="paired" onRender={onRender}>
    <div><span>{i} · SMC · {elements.map(e => `${e.kind} ${e.lo}–${e.hi}`).join(' · ')}</span>
      {withPanel && <SmcOrderflowPanel model={model} selected={['ob', 'sweep', 'fvg'][i % 3]} opts={styles} unit="BTC" onSelect={noop} onOption={noop} onClose={noop} />}</div></Profiler>;
  for (let i = 0; i < 220; i++) {
    let b = 0, f = 0;
    // Kolejność naprzemienna, te same dane i 20 elementów. Pomiar React render/commit osobno od następnej klatki.
    for (const panel of (i % 2 ? [true, false] : [false, true])) {
      const before = performance.now(); draw(panel ? fullLayer : baseLayer); flushSync(() => (panel ? benchmarkRoot : baselineRoot).render(view(panel, i)));
      const duration = performance.now() - before;
      if (panel) { f = duration; if (i >= 20) reactFull.push(measured); }
      else { b = duration; if (i >= 20) reactBase.push(measured); }
    }
    if (i >= 20) { base.push(b); full.push(f); extra.push(f - b); }
  }
  const frameAt = performance.now();
  const frameDelay: number | null = await Promise.race([new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now() - frameAt))), new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
  benchmarkRoot.unmount(); baselineRoot.unmount(); baseHost.remove(); fullHost.remove();
  return { synthetic: true, build: 'Vite development, React Profiler enabled', pairs: extra.length, alternated: true,
    baseline: 'separate mounted roots; same DOM source list for 20 SMC elements; no orderflow panel; stable callbacks', includes: 'updates of already open actual panel, three selected paths, all toggles on, retained events and replay controls',
    canvas: { sameSourceBars: source.length, sameProjection: '700x480 deterministic time/price transform', baselineObjects: baseLayer.selection() ? smcObjects(baseLayer.selection()!) : 0, synchronousCanvasCommands: true },
    excludes: 'browser compositor paint and unrelated application panels; frame probe reported separately',
    baselineP95Ms: percent(base, .95), fullP95Ms: percent(full, .95), additionalPairedP95Ms: percent(extra, .95), additionalP99Ms: percent(extra, .99),
    reactRenderP95: { baseline: percent(reactBase, .95), full: percent(reactFull, .95) },
    maxMs: Math.max(...full), over50: full.filter(x => x > 50).length, frameProbe: { samples: 1, delayMs: frameDelay, visibility: document.visibilityState, paintTimingMeasured: false },
    pass: percent(extra, .95) <= 8 };
}
(window as unknown as { smcVerification: unknown }).smcVerification = { model, journal: j, benchmark };
